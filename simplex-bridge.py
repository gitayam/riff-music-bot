#!/usr/bin/env python3
"""
SimpleX <-> zeroclaw bridge.

zeroclaw has no native SimpleX channel, so this process is the glue:
  * connects to the local simplex-chat WebSocket API (ws://127.0.0.1:5226),
  * on each incoming GROUP text message (not sent by the bot itself),
    runs `./run.sh agent -a hermes -m "<text>"` (per-sender session state),
  * sends the agent's reply back into the same group.

Reconnects on WS drop. zeroclaw calls are timeout-wrapped so one stuck
generation can't wedge the bridge. Pure stdlib + `websockets`.
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

import websockets

WS_URL = os.environ.get("SIMPLEX_WS_URL", "ws://127.0.0.1:5226")
DIR = Path(__file__).resolve().parent
RUN = str(DIR / "run.sh")
AGENT = os.environ.get("ZEROCLAW_AGENT", "hermes")
SESSIONS = DIR / "simplex" / "sessions"
LOG = DIR / "simplex" / "bridge.log"
AGENT_TIMEOUT = int(os.environ.get("BRIDGE_AGENT_TIMEOUT", "120"))
MAX_CHARS = 1800  # split long replies into SimpleX-friendly chunks


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", s) or "anon"


def ask_zeroclaw(group: str, sender: str, text: str) -> str:
    """Run a one-shot zeroclaw agent turn; return its reply text."""
    SESSIONS.mkdir(parents=True, exist_ok=True)
    state = SESSIONS / f"{slug(group)}__{slug(sender)}.json"
    try:
        proc = subprocess.run(
            [RUN, "agent", "-a", AGENT, "-m", text,
             "--session-state-file", str(state)],
            capture_output=True, text=True, timeout=AGENT_TIMEOUT, cwd=str(DIR),
        )
    except subprocess.TimeoutExpired:
        log(f"agent TIMEOUT after {AGENT_TIMEOUT}s (group={group} sender={sender})")
        return "(zeroclaw timed out generating a reply — try again.)"
    out = (proc.stdout or "").strip()
    if proc.returncode != 0 and not out:
        err = (proc.stderr or "").strip()[:300]
        log(f"agent error rc={proc.returncode}: {err}")
        return "(zeroclaw error — see bridge.log)"
    return out or "(no reply)"


def chunks(s: str, n: int):
    for i in range(0, len(s), n):
        yield s[i:i + n]


class Bridge:
    def __init__(self):
        self.ws = None
        self.seen = set()      # processed chat-item ids (dedupe duplicate events)

    async def cmd(self, c: str, timeout: float = 20):
        corr = "i" + uuid.uuid4().hex[:8]
        await self.ws.send(json.dumps({"corrId": corr, "cmd": c}))
        # responses to our corrId may be interleaved with async events; the
        # main loop also reads, so here we just fire-and-forget for sends.
        return corr

    async def send_group(self, group: str, text: str):
        for part in chunks(text, MAX_CHARS):
            await self.ws.send(json.dumps(
                {"corrId": "s" + uuid.uuid4().hex[:8], "cmd": f"#{group} {part}"}))
            await asyncio.sleep(0.3)

    def parse_incoming(self, resp: dict):
        """Yield (group, sender, text) for received GROUP text messages.

        Only NEW-message events — NOT 'chatItemsStatusesUpdated', which
        re-delivers the same item as a status update and would double-fire.
        Deduped by itemId for safety against any duplicate delivery.
        """
        if resp.get("type") not in ("newChatItems", "newChatItem"):
            return
        items = resp.get("chatItems")
        if items is None and "chatItem" in resp:
            items = [{"chatInfo": resp.get("chatInfo"),
                      "chatItem": resp.get("chatItem")}]
        for it in (items or []):
            info = it.get("chatInfo") or {}
            ci = it.get("chatItem") or {}
            if info.get("type") != "group":
                continue
            cdir = (ci.get("chatDir") or {}).get("type")
            if cdir != "groupRcv":          # only messages RECEIVED from others
                continue
            content = (ci.get("content") or {}).get("msgContent") or {}
            if content.get("type") != "text":
                continue
            text = (content.get("text") or "").strip()
            if not text:
                continue
            item_id = (ci.get("meta") or {}).get("itemId")
            if item_id is not None:
                if item_id in self.seen:
                    continue
                self.seen.add(item_id)
                if len(self.seen) > 5000:
                    self.seen = set(list(self.seen)[-2000:])
            group = (info.get("groupInfo") or {}).get("localDisplayName")
            member = ((ci.get("chatDir") or {}).get("groupMember") or {})
            sender = member.get("localDisplayName") or "member"
            if group:
                yield group, sender, text

    async def handle(self, group: str, sender: str, text: str):
        log(f"<- #{group} {sender}: {text[:120]}")
        reply = await asyncio.get_event_loop().run_in_executor(
            None, ask_zeroclaw, group, sender, text)
        log(f"-> #{group}: {reply[:120]}")
        await self.send_group(group, reply)

    async def run_once(self):
        async with websockets.connect(WS_URL, ping_interval=None,
                                      max_size=None) as ws:
            self.ws = ws
            log(f"connected to {WS_URL}; agent={AGENT}; listening for group messages")
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                resp = msg.get("resp") or {}
                for group, sender, text in self.parse_incoming(resp):
                    # handle sequentially so replies stay ordered
                    asyncio.create_task(self.handle(group, sender, text))

    async def run(self):
        while True:
            try:
                await self.run_once()
            except Exception as e:
                log(f"WS disconnected ({e!r}); reconnecting in 5s")
                await asyncio.sleep(5)


if __name__ == "__main__":
    try:
        asyncio.run(Bridge().run())
    except KeyboardInterrupt:
        log("bridge stopped")
        sys.exit(0)

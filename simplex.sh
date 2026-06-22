#!/usr/bin/env bash
# Manage zeroclaw's SimpleX surface: the simplex-chat WS daemon + the bridge
# that forwards group messages to `zeroclaw agent` and replies.
#
#   ./simplex.sh start     # start daemon + bridge (idempotent)
#   ./simplex.sh stop      # stop both
#   ./simplex.sh restart
#   ./simplex.sh status
#   ./simplex.sh link      # print the SimpleX group join link
#   ./simplex.sh logs      # tail daemon + bridge logs
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SX="${SIMPLEX_BIN:-$HOME/.local/bin/simplex-chat}"
PORT="${SIMPLEX_PORT:-5226}"
DB="$DIR/simplex/zeroclaw"
PY="$DIR/simplex/venv/bin/python"
DAEMON_LOG="$DIR/simplex/daemon.log"
BRIDGE_LOG="$DIR/simplex/bridge.log"

daemon_up() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; }
bridge_pid() { pgrep -f "simplex-bridge.py" | head -1; }

start_daemon() {
  if daemon_up; then echo "daemon: already listening on :$PORT"; return; fi
  mkdir -p "$DIR/simplex"
  nohup "$SX" -p "$PORT" -d "$DB" -y >"$DAEMON_LOG" 2>&1 </dev/null &
  for _ in $(seq 1 15); do daemon_up && break; sleep 1; done
  daemon_up && echo "daemon: started on :$PORT (pid $(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1))" \
            || { echo "daemon: FAILED to start — see $DAEMON_LOG"; tail -5 "$DAEMON_LOG"; exit 1; }
}

start_bridge() {
  if [ -n "$(bridge_pid)" ]; then echo "bridge: already running (pid $(bridge_pid))"; return; fi
  [ -x "$PY" ] || { echo "bridge: venv python missing at $PY"; exit 1; }
  nohup "$PY" "$DIR/simplex-bridge.py" >>"$BRIDGE_LOG" 2>&1 </dev/null &
  sleep 2
  [ -n "$(bridge_pid)" ] && echo "bridge: started (pid $(bridge_pid))" \
                         || { echo "bridge: FAILED — see $BRIDGE_LOG"; tail -5 "$BRIDGE_LOG"; exit 1; }
}

print_link() {
  daemon_up || { echo "daemon not running — ./simplex.sh start first"; exit 1; }
  "$PY" - <<'PY'
import asyncio, json, uuid, os
import websockets
WS=f"ws://127.0.0.1:{os.environ.get('SIMPLEX_PORT','5226')}"
async def cmd(ws,c):
    corr="i"+uuid.uuid4().hex[:8]
    await ws.send(json.dumps({"corrId":corr,"cmd":c}))
    for _ in range(80):
        m=json.loads(await asyncio.wait_for(ws.recv(),timeout=15))
        if m.get("corrId")==corr: return m.get("resp",{}) or {}
    return {}
def links(o,acc):
    if isinstance(o,str):
        if "simplex.chat/" in o or o.startswith("simplex:/"): acc.append(o)
    elif isinstance(o,dict):
        [links(v,acc) for v in o.values()]
    elif isinstance(o,list):
        [links(v,acc) for v in o]
async def main():
    async with websockets.connect(WS,ping_interval=None,max_size=None) as ws:
        r=await cmd(ws,"/show link #zeroclaw")
        if r.get("type")!="groupLink":
            r=await cmd(ws,"/create link #zeroclaw")
        acc=[]; links(r,acc)
        print(sorted(set(acc),key=len,reverse=True)[0] if acc else "(no link found)")
asyncio.run(main())
PY
}

case "${1:-start}" in
  start)   start_daemon; start_bridge; echo; echo "Group join link:"; print_link ;;
  stop)    pkill -f "simplex-bridge.py" 2>/dev/null && echo "bridge: stopped" || echo "bridge: not running"
           pkill -f "simplex-chat -p $PORT" 2>/dev/null && echo "daemon: stopped" || echo "daemon: not running" ;;
  restart) "$0" stop || true; sleep 2; "$0" start ;;
  status)  daemon_up && echo "daemon: UP (:$PORT)" || echo "daemon: DOWN"
           [ -n "$(bridge_pid)" ] && echo "bridge: UP (pid $(bridge_pid))" || echo "bridge: DOWN" ;;
  link)    print_link ;;
  logs)    echo "== daemon =="; tail -n 15 "$DAEMON_LOG" 2>/dev/null; echo "== bridge =="; tail -n 20 "$BRIDGE_LOG" 2>/dev/null ;;
  *) echo "usage: $0 {start|stop|restart|status|link|logs}"; exit 1 ;;
esac

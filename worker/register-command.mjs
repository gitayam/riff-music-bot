#!/usr/bin/env node
// register-command.mjs — register the /riff slash command with Discord (one-time, post-deploy).
//
// The P3 Interactions webhook (POST /discord/interactions) is INERT until this command exists — Discord
// only POSTs interactions for commands the app has registered. Run once after deploying the Worker and
// setting the app's Interactions Endpoint URL.
//
//   DISCORD_APP_ID=… DISCORD_BOT_TOKEN=… [DISCORD_GUILD_ID=…] node worker/register-command.mjs
//
// Guild-scoped (DISCORD_GUILD_ID set) registers INSTANTLY — use it to test in one server. Global
// (no guild id) is what you ship, but it takes up to ~1h to propagate. Idempotent: PUT replaces the
// app's full command set, so re-running is safe.
import { fileURLToPath } from "node:url";

// The command Riff answers (see handleDiscordInteraction / commandPrompt in src/index.js).
export const COMMANDS = [
  {
    name: "riff",
    type: 1, // CHAT_INPUT
    description: "Make music — Riff composes a Strudel loop or song from your prompt",
    options: [
      {
        type: 3, // STRING
        name: "prompt",
        description: "What to make, e.g. \"funky disco loop, 120bpm\" or \"a dark lofi song\"",
        required: true,
      },
    ],
  },
];

// PUT endpoint: guild-scoped (instant) when guildId is given, else global.
export function registerUrl(apiBase, appId, guildId) {
  const base = (apiBase || "https://discord.com/api/v10").replace(/\/+$/, "");
  return guildId
    ? `${base}/applications/${appId}/guilds/${guildId}/commands`
    : `${base}/applications/${appId}/commands`;
}

export async function registerCommands(env, fetchImpl = fetch) {
  const { DISCORD_APP_ID: appId, DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guild, DISCORD_API_BASE: apiBase } = env;
  if (!appId || !token) {
    const e = new Error("set DISCORD_APP_ID + DISCORD_BOT_TOKEN");
    e.code = 2;
    throw e;
  }
  const r = await fetchImpl(registerUrl(apiBase, appId, guild), {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bot ${token}` },
    body: JSON.stringify(COMMANDS),
  });
  const body = await r.text();
  if (!r.ok) {
    const e = new Error(`Discord register failed ${r.status}: ${body.slice(0, 300)}`);
    e.code = 1;
    throw e;
  }
  return { scope: guild ? `guild ${guild}` : "global", names: COMMANDS.map((c) => `/${c.name}`) };
}

async function main() {
  try {
    const out = await registerCommands(process.env);
    console.log(`registered ${out.names.join(", ")} (${out.scope})` +
      (out.scope === "global" ? " — global commands can take up to ~1h to appear" : ""));
  } catch (e) {
    console.error(e.message);
    process.exit(e.code || 1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

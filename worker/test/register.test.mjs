// Unit tests for the slash-command registration tool (no network — fetch is injected).
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMANDS, registerUrl, registerCommands } from "../register-command.mjs";

test("the /riff command has a required string 'prompt' option", () => {
  assert.equal(COMMANDS.length, 1);
  const c = COMMANDS[0];
  assert.equal(c.name, "riff");
  assert.equal(c.type, 1); // CHAT_INPUT
  const opt = c.options[0];
  assert.equal(opt.name, "prompt");
  assert.equal(opt.type, 3); // STRING
  assert.equal(opt.required, true);
});

test("registerUrl is guild-scoped when a guild id is given, else global", () => {
  assert.equal(registerUrl("https://discord.com/api/v10", "app1"),
    "https://discord.com/api/v10/applications/app1/commands");
  assert.equal(registerUrl("https://discord.com/api/v10", "app1", "g9"),
    "https://discord.com/api/v10/applications/app1/guilds/g9/commands");
  assert.equal(registerUrl("https://x/", "a"), "https://x/applications/a/commands"); // trailing slash trimmed
});

function fakeFetch(captured, { ok = true, status = 200, body = "[]" } = {}) {
  return async (url, init) => {
    captured.url = url; captured.init = init;
    return { ok, status, text: async () => body };
  };
}

test("registerCommands PUTs the command set with a bot auth header", async () => {
  const cap = {};
  const out = await registerCommands(
    { DISCORD_APP_ID: "app1", DISCORD_BOT_TOKEN: "tok", DISCORD_API_BASE: "https://d/api" },
    fakeFetch(cap)
  );
  assert.equal(cap.init.method, "PUT");
  assert.equal(cap.url, "https://d/api/applications/app1/commands");
  assert.equal(cap.init.headers.Authorization, "Bot tok");
  assert.match(cap.init.body, /"name":"riff"/);
  assert.match(cap.init.body, /"name":"prompt"/);
  assert.equal(out.scope, "global");
  assert.deepEqual(out.names, ["/riff"]);
});

test("registerCommands uses the guild endpoint when DISCORD_GUILD_ID is set", async () => {
  const cap = {};
  const out = await registerCommands(
    { DISCORD_APP_ID: "app1", DISCORD_BOT_TOKEN: "tok", DISCORD_GUILD_ID: "g9", DISCORD_API_BASE: "https://d/api" },
    fakeFetch(cap)
  );
  assert.match(cap.url, /\/guilds\/g9\/commands$/);
  assert.equal(out.scope, "guild g9");
});

test("registerCommands throws (code 2) when app id / token are missing", async () => {
  await assert.rejects(() => registerCommands({}, fakeFetch({})), (e) => e.code === 2);
});

test("registerCommands throws (code 1) on a non-OK Discord response", async () => {
  await assert.rejects(
    () => registerCommands({ DISCORD_APP_ID: "a", DISCORD_BOT_TOKEN: "t" }, fakeFetch({}, { ok: false, status: 401, body: "Unauthorized" })),
    (e) => e.code === 1 && /401/.test(e.message)
  );
});

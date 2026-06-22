// Test-only Ed25519 signer for the Discord interaction integration test (NOT used by the Worker).
//   node dev-sign.mjs genkey <keyfile>           -> writes {pubHex, privPem}, prints pubHex
//   node dev-sign.mjs sign   <keyfile> <ts>       -> signs (ts + stdin) with the key, prints sigHex
// Mirrors how Discord signs: Ed25519 over (timestamp + raw body). The Worker verifies with WebCrypto.
import crypto from "node:crypto";
import fs from "node:fs";

const [, , mode, keyfile, ts] = process.argv;

if (mode === "genkey") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" }); // raw 32-byte key = last 32 bytes of SPKI
  const pubHex = Buffer.from(der.subarray(der.length - 32)).toString("hex");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
  fs.writeFileSync(keyfile, JSON.stringify({ pubHex, privPem }));
  process.stdout.write(pubHex);
} else if (mode === "sign") {
  const { privPem } = JSON.parse(fs.readFileSync(keyfile, "utf8"));
  const body = fs.readFileSync(0); // stdin
  const msg = Buffer.concat([Buffer.from(ts, "utf8"), body]);
  const sig = crypto.sign(null, msg, crypto.createPrivateKey(privPem)); // Ed25519 → algorithm null
  process.stdout.write(sig.toString("hex"));
} else {
  process.stderr.write("usage: dev-sign.mjs genkey <keyfile> | sign <keyfile> <ts>\n");
  process.exit(2);
}

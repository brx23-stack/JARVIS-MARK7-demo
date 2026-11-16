#!/usr/bin/env node
// First-run setup: creates .env from .env.example and fills in JARVIS_ACCESS_TOKEN.
//
//   node scripts/setup.mjs            create .env if missing; add a token only if none is set
//   node scripts/setup.mjs --rotate   replace the existing token with a fresh one
//
// Safe to re-run: an existing token is never overwritten without --rotate.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN_LINE = /^JARVIS_ACCESS_TOKEN=(.*)$/m;

export function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/** Returns { text, changed, token } with the token set according to the rules above. Pure, so it is testable. */
export function applyToken(text, { rotate = false, token = generateToken() } = {}) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const match = TOKEN_LINE.exec(text);
  if (match) {
    const current = match[1].replace(/\r$/, "").trim();
    if (current && !rotate) return { text, changed: false, token: current };
    return { text: text.replace(TOKEN_LINE, `JARVIS_ACCESS_TOKEN=${token}`), changed: true, token };
  }
  const sep = text.length === 0 || text.endsWith("\n") ? "" : nl;
  return { text: `${text}${sep}JARVIS_ACCESS_TOKEN=${token}${nl}`, changed: true, token };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const envPath = path.join(root, ".env");
  const examplePath = path.join(root, ".env.example");
  const rotate = process.argv.includes("--rotate");

  let created = false;
  if (!fs.existsSync(envPath)) {
    if (!fs.existsSync(examplePath)) {
      console.error("Cannot find .env.example next to this script. Run this from the JARVIS repo.");
      process.exit(1);
    }
    fs.copyFileSync(examplePath, envPath);
    created = true;
  }

  const result = applyToken(fs.readFileSync(envPath, "utf8"), { rotate });
  if (result.changed) fs.writeFileSync(envPath, result.text);
  try { fs.chmodSync(envPath, 0o600); } catch { /* not supported on this filesystem (e.g. Windows) */ }

  console.log(created ? "Created .env from .env.example." : ".env already exists, left in place.");
  if (result.changed) {
    console.log(rotate ? "Rotated JARVIS_ACCESS_TOKEN." : "Generated JARVIS_ACCESS_TOKEN.");
    console.log(`\n  Your access token (you will enter this in the browser):\n\n  ${result.token}\n`);
  } else {
    console.log("JARVIS_ACCESS_TOKEN is already set. Use --rotate to replace it.");
  }
  console.log("Next: npm run dev   (or: docker compose up --build)");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

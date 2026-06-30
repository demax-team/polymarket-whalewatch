// Dashboard launcher — lets the server port come from an env var / .env file.
//
// Why a launcher instead of plain `next dev`: Next resolves its listen port from
// the `-p` flag or the PORT env var present AT LAUNCH; the `.env` it auto-loads
// for the app is NOT used for the server port. So we load `.env` first (via
// dotenv, already a dependency — same convention as worker/index.ts), resolve
// the port, and forward it to next with `-p`.
//
// Usage (wired in package.json):
//   node scripts/dev-server.mjs dev              → next dev          (Turbopack)
//   node scripts/dev-server.mjs dev --webpack    → next dev --webpack
//   node scripts/dev-server.mjs start            → next start
//
// Port precedence: an existing shell PORT wins (dotenv doesn't override), else
// .env's PORT, else 3000. Pass your own -p to override entirely.
import "dotenv/config";
import { spawn } from "node:child_process";

const DEFAULT_PORT = "3000";

function resolvePort() {
  const raw = process.env.PORT;
  if (raw == null || raw.trim() === "") return DEFAULT_PORT;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0 && n < 65536) return String(n);
  console.warn(`[dev-server] ignoring invalid PORT="${raw}", using ${DEFAULT_PORT}`);
  return DEFAULT_PORT;
}

const mode = process.argv[2] === "start" ? "start" : "dev";
const extra = process.argv.slice(3); // forwarded to next, e.g. --webpack
const port = resolvePort();

// Respect a caller-supplied -p/--port instead of double-adding one.
const callerSetPort = extra.some(
  (a) => a === "-p" || a === "--port" || a.startsWith("--port="),
);
const args = ["next", mode, ...extra, ...(callerSetPort ? [] : ["-p", port])];

console.log(
  `[dev-server] next ${args.slice(1).join(" ")}` +
    (callerSetPort ? "" : `  (port from ${process.env.PORT ? "env" : "default"})`),
);

const child = spawn("npx", args, { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

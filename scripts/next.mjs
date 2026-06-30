// Launcher for the Next.js CLI that loads .env first, so PORT (and any other
// env var) defined in .env is honored when starting the dashboard.
//
// Next's own CLI re-execs node with NODE_OPTIONS, which forbids `-r` and
// `--env-file`, so we can't inject dotenv that way. Instead we load .env into
// this process and spawn the Next CLI as a child — it inherits process.env
// (including PORT, which Next reads natively).
//
//   PORT in .env            -> used as the default port
//   PORT=4000 npm run dev   -> inline value wins (dotenv never overrides)
//
// Usage: node scripts/next.mjs <dev|start|build> [extra next args...]
import "dotenv/config";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const nextBin = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

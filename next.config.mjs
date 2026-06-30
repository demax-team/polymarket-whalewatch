import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the native better-sqlite3 module out of the server bundle so the
  // read-only dashboard can require it at runtime (Next 15+ stable key).
  serverExternalPackages: ["better-sqlite3"],
  // Pin the workspace root: a stray lockfile in the parent dir otherwise makes
  // Next infer the wrong root (it warns about multiple lockfiles).
  turbopack: {
    root: projectRoot,
  },
  // Webpack fallback (`next dev --webpack`, used when running from a git
  // worktree without local node_modules). serverExternalPackages externalizes
  // better-sqlite3 for route handlers under Turbopack, but does NOT cover the
  // instrumentation bundle under Webpack — so the native module gets bundled
  // and its `bindings → require('fs')` fails to resolve. Externalize it
  // explicitly for server builds. No effect on the default Turbopack runtime.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...config.externals, "better-sqlite3"];
    }
    return config;
  },
};

export default nextConfig;

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
};

export default nextConfig;

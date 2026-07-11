/** @type {import('next').NextConfig} */
const nextConfig = {
  // The dashboard is now a thin HTTP client of the coordinator (hono/client
  // over fetch) — no DB driver, no Node-only deps — so it deploys anywhere,
  // including edge/static hosts.
};

export default nextConfig;

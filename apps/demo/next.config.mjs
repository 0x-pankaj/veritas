/** @type {import('next').NextConfig} */
const nextConfig = {
  // @veritas/* workspace packages ship as source-mapped ESM; let Next transpile them.
  transpilePackages: ["@veritas/agent", "@veritas/core", "@veritas/seller", "@veritas/onchain"],
};

export default nextConfig;

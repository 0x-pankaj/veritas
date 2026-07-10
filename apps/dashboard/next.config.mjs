/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@veritas/coordinator", "@veritas/core"],
  // pg is a native-ish server dep; keep it external to the server bundle.
  serverExternalPackages: ["pg"],
};

export default nextConfig;

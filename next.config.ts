import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundles a minimal server (`.next/standalone`) with only the node_modules
  // a request actually needs — what the Dockerfile's runtime stage copies.
  // Vercel ignores this (it has its own build/runtime pipeline), so it's
  // additive: safe for both deployment targets.
  output: "standalone",
};

export default nextConfig;

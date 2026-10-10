import type { NextConfig } from "next";

/**
 * Baseline response headers for every route. A full Content-Security-Policy
 * is intentionally not set here: the Toss Payments SDK and Next's own inline
 * bootstrap scripts need a nonce-based policy that has to be rolled out and
 * tested on its own (see docs/QA_AUDIT.md "Remaining").
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking: nothing on this site is meant to be framed.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Bundles a minimal server (`.next/standalone`) with only the node_modules
  // a request actually needs — what the Dockerfile's runtime stage copies.
  // Vercel ignores this (it has its own build/runtime pipeline), so it's
  // additive: safe for both deployment targets.
  output: "standalone",
  poweredByHeader: false,
  // Shorts reference-image uploads go through a Server Action (the browser downsizes them first,
  // each file is capped at 3MB); the default 1MB body limit would reject most photos.
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

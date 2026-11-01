import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't advertise the framework in an `X-Powered-By` header. Security headers
  // themselves are set at the edge in vercel.json.
  poweredByHeader: false,
};

export default nextConfig;

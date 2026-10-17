import type { NextConfig } from "next";

// Security headers are applied in src/proxy.ts (Worker responses) and public/_headers
// (static asset layer), because next.config headers() did not match the root "/" route here.
const nextConfig: NextConfig = {};

export default nextConfig;

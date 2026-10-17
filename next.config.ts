import type { NextConfig } from "next";

/**
 * Security headers applied to every response (HTML, RSC and /api).
 * - HSTS: force HTTPS for a year across subdomains (all infra is Cloudflare TLS).
 * - X-Frame-Options + CSP frame-ancestors: block click-jacking (this is a financial app).
 * - nosniff: stop MIME sniffing. Referrer-Policy: don't leak full URLs cross-site.
 * - Permissions-Policy: deny camera/geolocation; allow microphone for the voice feature (self only).
 * The CSP is intentionally limited to framing/base/object hardening — a full script-src policy
 * needs per-render nonces and is tracked separately so it can't silently break the app.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), browsing-topics=(), microphone=(self)" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

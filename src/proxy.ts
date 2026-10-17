import { NextResponse, type NextRequest } from "next/server";

/**
 * Security headers on every Worker-rendered response (HTML, RSC and /api).
 * Static assets are covered by public/_headers (the asset layer bypasses middleware).
 *
 * - HSTS: force HTTPS for a year across subdomains (all infra is Cloudflare TLS).
 * - X-Frame-Options + CSP frame-ancestors: block click-jacking (this is a financial app).
 * - nosniff: stop MIME sniffing. Referrer-Policy: don't leak full URLs cross-site.
 * - Permissions-Policy: deny camera/geolocation; allow microphone for the voice feature (self only).
 * The CSP is limited to framing/base/object hardening; a full script-src policy needs
 * per-render nonces and is tracked separately so it can't silently break rendering.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), geolocation=(), browsing-topics=(), microphone=(self)",
  "Content-Security-Policy": "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
};

export function proxy(_req: NextRequest) {
  const res = NextResponse.next();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(key, value);
  return res;
}

export const config = {
  // List "/" explicitly — the negative-lookahead pattern does not match the root path.
  // Everything else except the static asset paths (those are handled by public/_headers).
  matcher: ["/", "/((?!_next/static|_next/image).*)"],
};

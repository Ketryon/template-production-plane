import type { NextConfig } from "next";

/**
 * OWASP's baseline set. A plane renders production data behind a login, usually
 * on a guessable URL, so omitting these is not a theoretical cost.
 *
 * No CSP here. A meaningful one needs YOUR app's real script and style sources
 * enumerated, and a wrong CSP breaks the page silently — a `default-src *` that
 * looks like protection is worse than an honest gap. Write one when you build a
 * UI, and record it in AUDIT.md until you do.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

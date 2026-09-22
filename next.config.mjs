import { assetContentSecurityPolicy } from "./lib/asset-security.js";

export default {
  output: "standalone",
  experimental:
    process.env.COLABIKE_WORKER_THREADS === "1"
      ? { workerThreads: true, webpackBuildWorker: false }
      : {},
  // Operator/backup scripts import these directly outside Next's server bundle.
  serverExternalPackages: ["pg", "zod", "fast-xml-parser"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      // Keep this last: the generic page policy must not replace the asset
      // sandbox when Next merges configured headers into a route response.
      {
        source: "/api/assets/:id",
        headers: [
          { key: "Content-Security-Policy", value: assetContentSecurityPolicy },
        ],
      },
    ];
  },
};

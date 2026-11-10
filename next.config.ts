import type { NextConfig } from "next";
import { validateBasePath } from "./src/application/shared/app-path.mjs";

const basePath = validateBasePath(process.env.BASE_PATH);

const nextConfig: NextConfig = {
  basePath,
  // Keep the folder entry inside Caddy's /folder/* route.
  skipTrailingSlashRedirect: Boolean(basePath),
  env: { BASE_PATH: basePath },
  output: "standalone",
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: `${basePath}/` },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'; object-src 'none'",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  experimental: {
    useTypeScriptCli: true,
    authInterrupts: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

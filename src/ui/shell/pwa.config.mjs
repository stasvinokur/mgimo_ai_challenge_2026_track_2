import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { serwist } from "@serwist/next/config";
import { appPath, basePath } from "../shared/app-path.mjs";
import { offlineDocument, pwaManifest } from "./pwa-assets.mjs";

// Build-only configuration lives in src so the Docker build copies it too.
export default serwist({
  swSrc: "src/ui/shell/pwa-worker.ts",
  swDest: "public/sw.js",
  esbuildOptions: {
    define: {
      "process.env.BASE_PATH": JSON.stringify(basePath()),
      "self.__PULSE_BUILD_ID": JSON.stringify(
        (
          await readFile(
            new URL("../../../.next/BUILD_ID", import.meta.url),
            "utf8",
          )
        ).trim(),
      ),
    },
  },
  precachePrerendered: false,
  globPatterns: [
    ".next/static/**/*.{js,css,woff,woff2}",
    "public/icons/*.png",
    "public/{pulse.svg,favicon.svg,offline.css,offline.js}",
  ],
  // Additional entries run after Serwist strips .html from discovered pages.
  additionalPrecacheEntries: [
    {
      url: appPath("/offline.html"),
      revision: createHash("sha256").update(offlineDocument()).digest("hex"),
    },
    {
      url: appPath("/manifest.webmanifest"),
      revision: createHash("sha256")
        .update(JSON.stringify(pwaManifest()))
        .digest("hex"),
    },
  ],
});

import { pwaManifest } from "@/ui/shell/pwa-assets.mjs";

export function GET() {
  return new Response(JSON.stringify(pwaManifest()), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "no-cache",
    },
  });
}

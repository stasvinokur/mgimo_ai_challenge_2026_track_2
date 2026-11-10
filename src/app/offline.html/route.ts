import { offlineDocument } from "@/ui/shell/pwa-assets.mjs";

export function GET() {
  return new Response(offlineDocument(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

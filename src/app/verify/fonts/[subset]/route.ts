import { certificates } from "@/composition/container";

export async function GET(
  _request: Request,
  context: { params: Promise<{ subset: string }> },
) {
  const { subset } = await context.params;
  if (subset !== "latin" && subset !== "cyrillic")
    return new Response(null, { status: 404 });
  const fonts = await certificates.fonts();
  return new Response(new Uint8Array(fonts[subset === "latin" ? 0 : 1]), {
    headers: {
      "Content-Type": "font/woff",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

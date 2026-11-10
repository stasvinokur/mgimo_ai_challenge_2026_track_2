import { mapActionError } from "@/app/_lib/map-errors";
import type { CertificateVerificationDto } from "@/application/certificates/verify-certificate";
import { certificates, getConcept } from "@/composition/container";
import { VerificationDocument } from "@/ui/certificates/verification-document";

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  let status = 200;
  let certificate: CertificateVerificationDto | undefined;
  try {
    const { code } = await context.params;
    certificate = await certificates.verify.execute({
      code,
      ipHash: certificates.ipHash(request.headers.get("x-forwarded-for")),
    });
  } catch (error) {
    status = mapActionError(error).status;
  }
  return new Response(
    VerificationDocument({
      retryUrl: new URL(request.url).pathname,
      certificate,
      status,
      tokens: await certificates.tokens(),
      notice: getConcept.execute().notice,
    }),
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Security-Policy": [
          "default-src 'none'",
          "style-src 'unsafe-inline'",
          "img-src 'self'",
          "font-src 'self'",
          "base-uri 'none'",
          "form-action 'none'",
          "frame-ancestors 'none'",
        ].join("; "),
        "X-Content-Type-Options": "nosniff",
        ...(status === 429 ? { "Retry-After": "600" } : {}),
      },
    },
  );
}

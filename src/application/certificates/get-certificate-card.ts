import type { Actor } from "@/application/ports/actor";
import { absoluteAppUrl } from "@/application/shared/app-path.mjs";
import { ForbiddenError, NotFoundError } from "@/application/shared/errors";
import { isCertificateNumber } from "@/domain/certificates/certificate";
import type { CertificateRepository, QrEncoder } from "./ports";
import { certificateRequestId } from "./schemas";

export class GetCertificateCard {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly qr: QrEncoder,
    private readonly appOrigin: () => string,
    private readonly basePath: () => string = () => "",
  ) {}

  async execute(actor: Actor, input: { id: string }) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const id = certificateRequestId.safeParse(input.id);
    if (!id.success) throw new NotFoundError();
    const record = await this.certificates.findByRequestIdForStudent(
      id.data,
      actor.studentId,
    );
    if (!record || !isCertificateNumber(record.number))
      throw new NotFoundError();
    const verificationUrl = absoluteAppUrl(
      this.appOrigin(),
      `/verify/${record.verifyCode}`,
      this.basePath(),
    );
    const png = await this.qr.encode(verificationUrl);
    const base64 = btoa(
      Array.from(png, (byte) => String.fromCharCode(byte)).join(""),
    );
    return {
      number: record.number,
      type: record.type,
      issuedAt: record.issuedAt,
      revoked: record.revokedAt !== null,
      verificationUrl,
      qrDataUrl: `data:image/png;base64,${base64}`,
    };
  }
}

export type CertificateCardDto = Awaited<
  ReturnType<GetCertificateCard["execute"]>
>;

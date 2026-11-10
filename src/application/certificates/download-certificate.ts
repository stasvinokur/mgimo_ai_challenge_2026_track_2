import type { Actor } from "@/application/ports/actor";
import { absoluteAppUrl } from "@/application/shared/app-path.mjs";
import { ForbiddenError, NotFoundError } from "@/application/shared/errors";
import type { StudentRepository } from "@/application/student/ports";
import { isCertificateNumber } from "@/domain/certificates/certificate";
import type { CertificateRepository, PdfRenderer, QrEncoder } from "./ports";
import { certificateRequestId } from "./schemas";

export class DownloadCertificate {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly students: StudentRepository,
    private readonly pdf: PdfRenderer,
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
    const profile = await this.students.findProfileForStudent(actor.studentId);
    if (!profile) throw new NotFoundError();
    const verificationUrl = absoluteAppUrl(
      this.appOrigin(),
      `/verify/${record.verifyCode}`,
      this.basePath(),
    );
    const bytes = await this.pdf.render(
      {
        number: record.number,
        type: record.type,
        destination: record.destination,
        issuedAt: record.issuedAt,
        revoked: record.revokedAt !== null,
        fullName: profile.fullName,
        faculty: profile.faculty,
        program: profile.program,
        course: profile.course,
        group: profile.group,
        verificationUrl,
      },
      await this.qr.encode(verificationUrl),
    );
    return { number: record.number, bytes };
  }
}

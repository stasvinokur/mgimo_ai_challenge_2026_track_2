export interface CertificateRecord {
  number: string;
  verifyCode: string;
  issuedAt: string;
  revokedAt: string | null;
  studentId: string;
  type: string;
  destination: string;
}

export interface CertificateRepository {
  findByRequestIdForStudent(
    requestId: string,
    studentId: string,
  ): Promise<CertificateRecord | null>;
  findByVerificationCode(code: string): Promise<CertificateRecord | null>;
}

export interface CertificatePdfData {
  number: string;
  type: string;
  destination: string;
  issuedAt: string;
  revoked: boolean;
  fullName: string;
  faculty: string;
  program: string;
  course: number;
  group: string;
  verificationUrl: string;
}

export interface PdfRenderer {
  render(data: CertificatePdfData, qrPng: Uint8Array): Promise<Uint8Array>;
}

export interface QrEncoder {
  encode(url: string): Promise<Uint8Array>;
}

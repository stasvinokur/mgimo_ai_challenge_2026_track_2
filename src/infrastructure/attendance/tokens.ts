import { createHash, randomBytes } from "node:crypto";
import type { AttendanceTokens } from "@/application/attendance/qr-ports";

export class CryptoAttendanceTokens implements AttendanceTokens {
  generate() {
    return randomBytes(16).toString("base64url");
  }
  hash(code: string) {
    return createHash("sha256").update(code).digest("hex");
  }
}

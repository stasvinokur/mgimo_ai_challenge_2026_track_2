import QRCode from "qrcode";
import type { AttendanceQrEncoder } from "@/application/attendance/qr-ports";

const svgEncoder = QRCode as typeof QRCode & {
  toString(
    text: string,
    options: { type: "svg"; errorCorrectionLevel: "M"; margin: number },
  ): Promise<string>;
};

export class LocalAttendanceQrEncoder implements AttendanceQrEncoder {
  async encode(url: string) {
    const svg = await svgEncoder.toString(url, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 4,
    });
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}

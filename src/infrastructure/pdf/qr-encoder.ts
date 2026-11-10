import QRCode from "qrcode";
import type { QrEncoder } from "@/application/certificates/ports";

export class LocalQrEncoder implements QrEncoder {
  async encode(url: string): Promise<Uint8Array> {
    return QRCode.toBuffer(url, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 4,
      width: 320,
    });
  }
}

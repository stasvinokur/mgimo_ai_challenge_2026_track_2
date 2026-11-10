declare module "qrcode" {
  const QRCode: {
    toBuffer(
      text: string,
      options: {
        type: "png";
        errorCorrectionLevel: "M";
        margin: number;
        width: number;
      },
    ): Promise<Buffer>;
  };
  export default QRCode;
}

import QRCode from 'qrcode';

/** Render a value (address or wallet URI) to a PNG data URL. */
export async function toQrDataUrl(
  value: string,
  options?: { size?: number; dark?: string; light?: string },
): Promise<string> {
  return QRCode.toDataURL(value, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: options?.size ?? 220,
    color: {
      dark: options?.dark ?? '#0c1310',
      light: options?.light ?? '#ffffff',
    },
  });
}

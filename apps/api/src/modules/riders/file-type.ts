// Detects an upload's real type from its first bytes. The client's Content-Type header is ignored.

export interface DetectedFileType {
  contentType: "image/jpeg" | "image/png" | "application/pdf";
  ext: "jpg" | "png" | "pdf";
  isImage: boolean;
}

const startsWith = (data: Buffer, signature: number[]) =>
  data.length >= signature.length && signature.every((byte, i) => data[i] === byte);

export function detectFileType(data: Buffer): DetectedFileType | null {
  if (startsWith(data, [0xff, 0xd8, 0xff])) return { contentType: "image/jpeg", ext: "jpg", isImage: true };
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: "image/png", ext: "png", isImage: true };
  }
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { contentType: "application/pdf", ext: "pdf", isImage: false }; // %PDF-
  return null;
}

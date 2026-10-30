const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export function isSafeImage(bytes: Uint8Array, mediaType: string): boolean {
  if (bytes.length < 8 || bytes.length > 2 * 1024 * 1024) {
    return false;
  }
  if (mediaType === "image/png") {
    return PNG.every((byte, index) => bytes[index] === byte);
  }
  return (
    mediaType === "image/jpeg" &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}
export function attachmentId(url: string, origin: string): string | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.origin !== new URL(origin).origin ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    const match =
      /^\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
        parsed.pathname
      );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function isSafeText(bytes: Uint8Array, mediaType: string): boolean {
  if (
    mediaType !== "text/plain" ||
    !bytes.length ||
    bytes.length > 32 * 1024 ||
    bytes.includes(0)
  ) {
    return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Bound actual streamed bytes, not merely an untrusted Content-Length header. */
export async function readLimitedJson(
  request: Request,
  maxBytes: number
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new Error("Missing request body");
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    // biome-ignore lint/performance/noAwaitInLoops: Sequential reads enforce the byte limit.
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("Request body exceeds limit");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

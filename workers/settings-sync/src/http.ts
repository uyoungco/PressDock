import { LIMITS, ProtocolError } from "./protocol.ts";
import { ServiceError } from "./service-error.ts";

export async function readBody(
  request: Request,
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new ServiceError("UNSUPPORTED_MEDIA_TYPE", 415);
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > LIMITS.documentBytes)
    throw new ProtocolError("PAYLOAD_TOO_LARGE");
  if (!request.body) throw new ProtocolError("INVALID_DOCUMENT");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 15000);
  try {
    while (true) {
      const next = await reader.read();
      if (timedOut) throw new ServiceError("REQUEST_TIMEOUT", 408, true);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > LIMITS.documentBytes) {
        await reader.cancel();
        throw new ProtocolError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(next.value);
    }
    const raw = new Uint8Array(size);
    let offset = 0;
    for (const part of chunks) {
      raw.set(part, offset);
      offset += part.byteLength;
    }
    return raw;
  } catch (error) {
    if (error instanceof ServiceError || error instanceof ProtocolError)
      throw error;
    throw new ProtocolError("INVALID_DOCUMENT");
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

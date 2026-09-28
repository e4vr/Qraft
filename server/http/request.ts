const decoder = new TextDecoder();

export async function readLimitedBytes(
  request: Request,
  maximumBytes: number,
): Promise<ArrayBuffer> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > maximumBytes)
    throw new Response('Request payload is too large.', { status: 413 });
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      // A cloned request uses a tee: awaiting cancellation here can deadlock
      // until the notification branch is also cancelled by the lifecycle.
      void reader.cancel().catch(() => undefined);
      throw new Response('Request payload is too large.', { status: 413 });
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

async function readLimitedText(
  request: Request,
  maximumBytes: number,
): Promise<string> {
  return decoder.decode(await readLimitedBytes(request, maximumBytes));
}

export async function readJson<T>(
  request: Request,
  maximumBytes = 64_000,
): Promise<T> {
  try {
    const value: unknown = JSON.parse(await readLimitedText(request, maximumBytes));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Response('Expected a JSON object.', { status: 400 });
    return value as T;
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response('Invalid JSON payload.', { status: 400 });
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site')
    throw new Response('Cross-origin request rejected.', { status: 403 });
}

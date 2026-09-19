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
      await reader.cancel();
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
    return JSON.parse(await readLimitedText(request, maximumBytes)) as T;
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response('Invalid JSON payload.', { status: 400 });
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    throw new Response('Cross-origin request rejected.', { status: 403 });
}

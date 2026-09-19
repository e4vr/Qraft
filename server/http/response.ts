export function json(
  value: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('cache-control', 'no-store');
  return Response.json(value, { status, headers: responseHeaders });
}

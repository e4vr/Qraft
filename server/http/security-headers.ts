const DOCUMENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob: https:",
].join('; ');

export function withSecurityHeaders(
  request: Request,
  response: Response,
): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('cross-origin-resource-policy', 'same-origin');
  if (headers.get('content-type')?.includes('text/html'))
    headers.set('content-security-policy', DOCUMENT_SECURITY_POLICY);
  if (new URL(request.url).protocol === 'https:')
    headers.set(
      'strict-transport-security',
      'max-age=31536000; includeSubDomains',
    );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

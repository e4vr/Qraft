const API_ROOT = '/api/cloudflare';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData))
    headers.set('content-type', 'application/json');
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok)
    throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

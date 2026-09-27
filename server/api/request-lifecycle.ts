import { env } from 'cloudflare:workers';
import { shareCurrentUserRequest } from '@/features/auth/server/auth-service';
import { notifyMutation } from '@/lib/realtime-server';
import { maintenanceGate } from '@/features/administration/server/operations-service';

export function cloudflarePathParts(request: Request): string[] {
  return new URL(request.url).pathname.split('/').slice(3).map(decodeURIComponent);
}

function clientKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'local-or-unknown';
}

async function enforceRateLimits(request: Request): Promise<void> {
  const key = clientKey(request);
  const general = await env.API_RATE_LIMITER?.limit({ key });
  if (general && !general.success) {
    throw Response.json(
      { error: 'Too many requests. Try again shortly.' },
      {
        status: 429,
        headers: { 'retry-after': '60', 'cache-control': 'no-store' },
      },
    );
  }

  if (request.method !== 'GET') {
    const mutation = await env.MUTATION_RATE_LIMITER?.limit({ key });
    if (mutation && !mutation.success) {
      throw Response.json(
        { error: 'Too many changes. Try again shortly.' },
        {
          status: 429,
          headers: { 'retry-after': '60', 'cache-control': 'no-store' },
        },
      );
    }
  }

  const [scope, action] = cloudflarePathParts(request);
  if (
    scope === 'auth' &&
    ['register', 'login', 'mfa', 'mfa-begin', 'mfa-complete'].includes(
      action ?? '',
    )
  ) {
    const auth = await env.AUTH_RATE_LIMITER?.limit({ key });
    if (auth && !auth.success) {
      throw Response.json(
        {
          error:
            'Too many authentication attempts. Try again in one minute.',
        },
        {
          status: 429,
          headers: { 'retry-after': '60', 'cache-control': 'no-store' },
        },
      );
    }
  }
}

export async function withApiLifecycle(
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    await enforceRateLimits(request);
    const maintenance = await maintenanceGate(request, true);
    if (maintenance) return maintenance;
    const notification = request.method === 'GET' ? undefined : request.clone();
    const response = await run();

    if (
      notification &&
      response.ok &&
      response.headers.get('x-qraft-unchanged') !== '1'
    ) {
      try {
        shareCurrentUserRequest(request, notification);
        await notifyMutation(notification as Request);
      } catch {
        console.error(
          JSON.stringify({ event: 'realtime_notification_failed' }),
        );
      }
    }

    return response;
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(
      JSON.stringify({
        event: 'cloudflare_api_error',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json(
      { error: 'The request could not be completed.' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}

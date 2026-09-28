import { env } from 'cloudflare:workers';
import {
  currentUser,
  shareCurrentUserRequest,
} from '@/features/auth/server/auth-service';
import { assertSameOrigin } from '@/server/http/request';
import { enforceRequestLimits } from '@/server/http/rate-limit';
import {
  needsMutationNotification,
  notifyMutation,
} from '@/lib/realtime-server';
import { maintenanceGate } from '@/features/administration/server/operations-service';

export function cloudflarePathParts(request: Request): string[] {
  try {
    return new URL(request.url).pathname
      .split('/')
      .slice(3)
      .map(decodeURIComponent);
  } catch {
    throw Response.json({ error: 'Invalid request path.' }, { status: 400 });
  }
}

export async function withApiLifecycle(
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  let notification: Request | undefined;
  const finish = async (response: Response) => {
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    headers.delete('x-qraft-result-owner');
    headers.set('x-request-id', requestId);
    if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
    if (
      response.status >= 400 &&
      !headers.get('content-type')?.includes('application/json')
    ) {
      headers.set('content-type', 'application/json');
      return Response.json(
        { error: await response.text(), requestId },
        { status: response.status, headers },
      );
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
      assertSameOrigin(request);
    await enforceRequestLimits(request, cloudflarePathParts(request), env, () =>
      currentUser(request),
    );
    const expectedUser = request.headers.get('x-qraft-account');
    if (expectedUser && (await currentUser(request))?.uid !== expectedUser)
      return finish(
        Response.json(
          {
            error:
              'The signed-in account changed. Sign in to the original account to synchronize its pending changes.',
            code: 'ACCOUNT_CHANGED',
          },
          { status: 409, headers: { 'cache-control': 'no-store' } },
        ),
      );
    const maintenance = await maintenanceGate(request, true);
    if (maintenance) return finish(maintenance);
    notification = needsMutationNotification(request)
      ? (request.clone() as Request)
      : undefined;
    const response = await run();

    if (
      notification &&
      response.ok &&
      response.headers.get('x-qraft-unchanged') !== '1'
    ) {
      try {
        shareCurrentUserRequest(request, notification);
        await notifyMutation(notification, response);
      } catch {
        console.error(
          JSON.stringify({ event: 'realtime_notification_failed', requestId }),
        );
      }
    }

    return finish(response);
  } catch (error) {
    if (error instanceof Response) return finish(error);
    console.error(
      JSON.stringify({
        event: 'cloudflare_api_error',
        requestId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
    return finish(
      Response.json(
        { error: 'The request could not be completed.', requestId },
        { status: 500, headers: { 'cache-control': 'no-store' } },
      ),
    );
  } finally {
    if (notification?.body && !notification.bodyUsed)
      void notification.body.cancel().catch(() => undefined);
  }
}

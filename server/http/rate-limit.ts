type LimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};
type RequestLimiters = {
  API_RATE_LIMITER?: LimitBinding;
  MUTATION_RATE_LIMITER?: LimitBinding;
  AUTH_RATE_LIMITER?: LimitBinding;
};

async function consume(
  binding: LimitBinding | undefined,
  key: string,
  message: string,
) {
  if (binding && !(await binding.limit({ key })).success)
    throw Response.json(
      { error: message, code: 'RATE_LIMITED' },
      {
        status: 429,
        headers: { 'retry-after': '60', 'cache-control': 'no-store' },
      },
    );
}

export async function enforceRequestLimits(
  request: Request,
  [scope, action]: string[],
  bindings: RequestLimiters,
  resolveUser: () => Promise<{ uid: string } | undefined>,
): Promise<void> {
  const ipKey = `ip:${request.headers.get('cf-connecting-ip') ?? 'local-or-unknown'}`;
  const authentication =
    scope === 'auth' &&
    ['register', 'login', 'mfa', 'mfa-begin', 'mfa-complete'].includes(
      action ?? '',
    );
  // Authentication stays IP-protected, before any account lookup or password work.
  if (authentication)
    await consume(
      bindings.AUTH_RATE_LIMITER,
      ipKey,
      'Too many authentication attempts. Try again in one minute.',
    );
  if (scope === 'platform' && action === 'activation-code' && request.method === 'POST')
    await consume(bindings.AUTH_RATE_LIMITER, `activation:${ipKey}`, 'Too many activation attempts. Try again in one minute.');
  // The identity comes only from a verified server session. Cookie values and
  // client-supplied user IDs must never create arbitrary rate-limit buckets.
  const user =
    !authentication &&
    (bindings.API_RATE_LIMITER || bindings.MUTATION_RATE_LIMITER)
      ? await resolveUser()
      : undefined;
  const key = user ? `user:${user.uid}` : ipKey;
  await consume(
    bindings.API_RATE_LIMITER,
    key,
    'Too many requests. Try again shortly.',
  );
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
    await consume(
      bindings.MUTATION_RATE_LIMITER,
      key,
      'Too many changes. Try again shortly.',
    );
}

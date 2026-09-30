import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

void test('Phase 4 server trust boundaries remain enforced', async () => {
  const [cloudflare, platform, preformed, worker, headers] = await Promise.all([
    readFile(new URL('lib/cloudflare-server.ts', root), 'utf8'),
    readFile(new URL('lib/platform-server.ts', root), 'utf8'),
    readFile(new URL('lib/preformed-test-server.ts', root), 'utf8'),
    readFile(new URL('worker.ts', root), 'utf8'),
    readFile(new URL('server/http/security-headers.ts', root), 'utf8'),
  ]);
  assert.match(
    cloudflare,
    /operation\.collection === 'auditLog'\) return false/,
  );
  assert.match(cloudflare, /replacementToken/);
  assert.match(cloudflare, /DELETE FROM sessions WHERE token_hash=\?/);
  assert.match(cloudflare, /qraft-login-timing-v1/);
  assert.match(cloudflare, /isRoot \? 300 : SESSION_SECONDS/);
  assert.match(cloudflare, /uid,\s*!isRoot,/);
  assert.match(cloudflare, /row\.verified === 1/);
  assert.match(cloudflare, /preformed_attempt_tokens/);
  assert.match(cloudflare, /readyMadeTest\.visibility === 'public'/);
  assert.match(platform, /BACKUP_SIGNING_KEY/);
  assert.match(platform, /hmac-sha256-v1/);
  assert.match(platform, /conflict with data owned by another account/);
  assert.match(preformed, /preformed_participation/);
  assert.match(preformed, /if \(!owner && row\.status !== 'published'\)/);
  assert.match(preformed, /authorizePrivateMedia/);
  assert.match(worker, /withSecurityHeaders/);
  for (const name of [
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
  ])
    assert.match(headers, new RegExp(name));
});

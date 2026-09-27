export function preformedAccountScope(uid: string): string {
  return `user:${uid}`;
}

export function preformedAttemptKey(scope: string, testId: string, version: number): string {
  return `preformed:${scope}:attempt:${testId}:${version}`;
}

export function preformedCodeKey(scope: string, code: string): string {
  return `preformed:${scope}:code:${code}`;
}

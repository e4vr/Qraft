// Bind an idempotency receipt to its question contents. Object key order is
// irrelevant, while arrays preserve question, choice and image order.
export async function importSubmissionFingerprint(input: Record<string, unknown>) {
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, ordered(item)])) : value;
  const encoded = new TextEncoder().encode(JSON.stringify(ordered({ questions: input.questions, sourceFile: input.sourceFile ?? '' })));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoded))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

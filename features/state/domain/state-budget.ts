// Transitional bound for the legacy snapshot. Subscription quotas are separate.
export const STATE_BUDGET_BYTES = 1_500_000;
export const STATE_WARNING_BYTES = 1_200_000;

export function stateBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function stateBudgetError(value: unknown): string | undefined {
  return stateBytes(value) > STATE_BUDGET_BYTES
    ? 'Your study data exceeds the current sync capacity. It remains on this device. Export a backup before removing old data.'
    : undefined;
}

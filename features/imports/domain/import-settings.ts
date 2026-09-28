export interface ImportSettings {
  enabled: boolean;
  maxFileMegabytes: number;
  previewBatchSize: number;
}

export const DEFAULT_IMPORT_SETTINGS: ImportSettings = { enabled: true, maxFileMegabytes: 1.5, previewBatchSize: 50 };
export const ADMIN_MAX_FILE_BYTES = 50_000_000;

export function validImportSettings(value: unknown): value is ImportSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as ImportSettings;
  return typeof settings.enabled === 'boolean' && Number.isFinite(settings.maxFileMegabytes) && settings.maxFileMegabytes >= 0.5 && settings.maxFileMegabytes <= 50 &&
    [25, 50, 100].includes(settings.previewBatchSize);
}

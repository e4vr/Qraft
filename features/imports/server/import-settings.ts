import { env } from 'cloudflare:workers';
import { DEFAULT_IMPORT_SETTINGS, validImportSettings } from '@/features/imports/domain/import-settings';

export async function importSettings() {
  const row = await env.DB.prepare("SELECT payload FROM records WHERE type='system' AND id='importSettings'").first<{ payload: string }>();
  if (!row) return DEFAULT_IMPORT_SETTINGS;
  const value = JSON.parse(row.payload) as unknown;
  return validImportSettings(value) ? value : DEFAULT_IMPORT_SETTINGS;
}

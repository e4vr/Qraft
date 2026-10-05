import { env } from 'cloudflare:workers';
import {
  DEFAULT_ANNOUNCEMENT,
  type SiteAnnouncement,
} from '../domain/announcement';

export async function announcementSettings(): Promise<SiteAnnouncement> {
  const row = await env.DB.prepare(
    "SELECT payload,updated_at FROM records WHERE type='system' AND id='announcement' LIMIT 1",
  ).first<{ payload: string; updated_at: string }>();
  if (!row) return { ...DEFAULT_ANNOUNCEMENT, images: [] };
  const stored = JSON.parse(row.payload) as Partial<SiteAnnouncement>;
  return {
    ...DEFAULT_ANNOUNCEMENT,
    ...stored,
    // Older records may use visit mode; every activation is now once per account.
    displayMode: 'once',
    images: stored.images ?? [],
    revision: stored.revision ?? row.updated_at,
  };
}

import { env } from 'cloudflare:workers';
import {
  initialCollaborationState,
  type QBank,
  type QBankMembership,
} from './medguard-types';

export async function bankAccessStates(bankIds: Iterable<string>) {
  const ids = [...new Set(bankIds)].filter(Boolean);
  if (!ids.length) return { qbanks: [], memberships: [] };
  const rows = await env.DB.prepare(
    `SELECT record.type,record.payload
      FROM json_each(?) AS bank
      CROSS JOIN records AS record INDEXED BY idx_records_type_id
      WHERE record.type='qbanks' AND record.id=bank.value
      UNION ALL
      SELECT record.type,record.payload
      FROM json_each(?) AS bank
      CROSS JOIN records AS record INDEXED BY idx_records_type_id
      WHERE record.type='qbankTombstones' AND record.id=bank.value
      UNION ALL
      SELECT record.type,record.payload
      FROM json_each(?) AS bank
      CROSS JOIN records AS record INDEXED BY idx_records_qbank_type
      WHERE record.qbank_id=bank.value AND record.type='qbankMemberships'`,
  )
    .bind(JSON.stringify(ids), JSON.stringify(ids), JSON.stringify(ids))
    .all<{ type: string; payload: string }>();
  const storedBanks = rows.results
    .filter((row) => row.type === 'qbanks')
    .map((row) => JSON.parse(row.payload) as QBank);
  const deletedIds = new Set(rows.results.filter(row => row.type === 'qbankTombstones')
    .map(row => (JSON.parse(row.payload) as { id: string }).id));
  return {
    qbanks: storedBanks.filter(bank => !deletedIds.has(bank.id)).concat(
      ids.includes('smle-gs') &&
        !deletedIds.has('smle-gs') &&
        !storedBanks.some((bank) => bank.id === 'smle-gs')
        ? initialCollaborationState().qbanks
        : [],
    ),
    memberships: rows.results
      .filter((row) => row.type === 'qbankMemberships')
      .map((row) => JSON.parse(row.payload) as QBankMembership),
  };
}

export function bankAccessState(bankId: string) {
  return bankAccessStates([bankId]);
}

import Dexie, { type EntityTable } from 'dexie';
import type { LocalTrade, LocalJournalEntry, LocalStrategy } from '../types';

/**
 * TradeTogether local database (IndexedDB via Dexie).
 *
 * Every mutable record carries:
 *   _sync_status: 'synced' | 'pending' | 'error'
 *   _updated_at:  ISO timestamp of last local change
 *   _deleted_at:  ISO timestamp if soft-deleted (tombstone), null otherwise
 *
 * Records are NOT physically removed until deletion is successfully synced.
 */
class TradeTogetherDB extends Dexie {
  trades!: EntityTable<LocalTrade, 'id'>;
  journal_entries!: EntityTable<LocalJournalEntry, 'id'>;
  strategies!: EntityTable<LocalStrategy, 'id'>;

  constructor() {
    super('TradeTogether');

    this.version(1).stores({
      trades: 'id, workspace_id, user_id, trade_date, strategy_id, _sync_status, _deleted_at',
      journal_entries: 'id, workspace_id, user_id, entry_date, _sync_status, _deleted_at',
      strategies: 'id, workspace_id, _sync_status, _deleted_at',
    });
  }
}

export const db = new TradeTogetherDB();

// ─── Helper: create a local record with sync metadata ───────────────────────

import type { SyncStatus } from '../types';

export function withSyncMeta<T>(record: T, status: SyncStatus = 'pending'): T & {
  _sync_status: SyncStatus;
  _updated_at: string;
  _deleted_at: null;
} {
  return {
    ...record,
    _sync_status: status,
    _updated_at: new Date().toISOString(),
    _deleted_at: null,
  };
}

/**
 * TradeTogether — Sync Engine
 *
 * Simple, reliable sync between IndexedDB (local) and Supabase (cloud).
 *
 * Rules:
 *  - IndexedDB is the fast local cache
 *  - Supabase is the source of truth
 *  - Never lose pending local changes
 *  - Soft-deleted records stay local until deletion synced
 *  - Auto-retry on connectivity change
 */

import { supabase } from './supabase';
import { db } from '../db';

// ─── Push local pending changes to Supabase ─────────────────────────────────

async function pushPendingTrades(): Promise<void> {
  const pending = await db.trades
    .where('_sync_status').equals('pending')
    .toArray();

  for (const trade of pending) {
    try {
      if (trade._deleted_at) {
        // Delete from cloud
        const { error } = await supabase.from('trades').delete().eq('id', trade.id);
        if (!error) {
          // Safe to physically remove now
          await db.trades.delete(trade.id);
        } else {
          await db.trades.update(trade.id, { _sync_status: 'error' });
        }
      } else {
        // Upsert to cloud (strip local-only fields)
        const { _sync_status, _updated_at, _deleted_at, ...cloudRecord } = trade;
        const { error } = await supabase.from('trades').upsert(cloudRecord);
        if (!error) {
          await db.trades.update(trade.id, { _sync_status: 'synced' });
        } else {
          await db.trades.update(trade.id, { _sync_status: 'error' });
        }
      }
    } catch {
      await db.trades.update(trade.id, { _sync_status: 'error' });
    }
  }
}

async function pushPendingJournalEntries(): Promise<void> {
  const pending = await db.journal_entries
    .where('_sync_status').equals('pending')
    .toArray();

  for (const entry of pending) {
    try {
      if (entry._deleted_at) {
        const { error } = await supabase.from('journal_entries').delete().eq('id', entry.id);
        if (!error) {
          await db.journal_entries.delete(entry.id);
        } else {
          await db.journal_entries.update(entry.id, { _sync_status: 'error' });
        }
      } else {
        const { _sync_status, _updated_at, _deleted_at, ...cloudRecord } = entry;
        const { error } = await supabase.from('journal_entries').upsert(cloudRecord);
        if (!error) {
          await db.journal_entries.update(entry.id, { _sync_status: 'synced' });
        } else {
          await db.journal_entries.update(entry.id, { _sync_status: 'error' });
        }
      }
    } catch {
      await db.journal_entries.update(entry.id, { _sync_status: 'error' });
    }
  }
}

async function pushPendingStrategies(): Promise<void> {
  const pending = await db.strategies
    .where('_sync_status').equals('pending')
    .toArray();

  for (const strategy of pending) {
    try {
      if (strategy._deleted_at) {
        const { error } = await supabase.from('strategies').delete().eq('id', strategy.id);
        if (!error) {
          await db.strategies.delete(strategy.id);
        } else {
          await db.strategies.update(strategy.id, { _sync_status: 'error' });
        }
      } else {
        const { _sync_status, _updated_at, _deleted_at, ...cloudRecord } = strategy;
        const { error } = await supabase.from('strategies').upsert(cloudRecord);
        if (!error) {
          await db.strategies.update(strategy.id, { _sync_status: 'synced' });
        } else {
          await db.strategies.update(strategy.id, { _sync_status: 'error' });
        }
      }
    } catch {
      await db.strategies.update(strategy.id, { _sync_status: 'error' });
    }
  }
}

// ─── Pull from Supabase into IndexedDB ──────────────────────────────────────

async function pullTrades(workspaceId: string): Promise<void> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error || !data) return;

  for (const cloudTrade of data) {
    const local = await db.trades.get(cloudTrade.id);
    // Don't overwrite pending local changes
    if (local && local._sync_status === 'pending') continue;

    await db.trades.put({
      ...cloudTrade,
      _sync_status: 'synced' as const,
      _updated_at: cloudTrade.updated_at,
      _deleted_at: null,
    });
  }
}

async function pullJournalEntries(workspaceId: string): Promise<void> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error || !data) return;

  for (const cloudEntry of data) {
    const local = await db.journal_entries.get(cloudEntry.id);
    if (local && local._sync_status === 'pending') continue;

    await db.journal_entries.put({
      ...cloudEntry,
      _sync_status: 'synced' as const,
      _updated_at: cloudEntry.updated_at,
      _deleted_at: null,
    });
  }
}

async function pullStrategies(workspaceId: string): Promise<void> {
  const { data, error } = await supabase
    .from('strategies')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error || !data) return;

  for (const cloudStrategy of data) {
    const local = await db.strategies.get(cloudStrategy.id);
    if (local && local._sync_status === 'pending') continue;

    await db.strategies.put({
      ...cloudStrategy,
      _sync_status: 'synced' as const,
      _updated_at: cloudStrategy.updated_at,
      _deleted_at: null,
    });
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function syncToCloud(): Promise<void> {
  if (!navigator.onLine) return;
  await Promise.all([
    pushPendingTrades(),
    pushPendingJournalEntries(),
    pushPendingStrategies(),
  ]);
}

export async function syncFromCloud(workspaceId: string): Promise<void> {
  if (!navigator.onLine) return;
  await Promise.all([
    pullTrades(workspaceId),
    pullJournalEntries(workspaceId),
    pullStrategies(workspaceId),
  ]);
}

export async function fullSync(workspaceId: string): Promise<void> {
  await syncToCloud();
  await syncFromCloud(workspaceId);
}

export function getPendingCount(): Promise<number> {
  return Promise.all([
    db.trades.where('_sync_status').equals('pending').count(),
    db.journal_entries.where('_sync_status').equals('pending').count(),
    db.strategies.where('_sync_status').equals('pending').count(),
  ]).then(counts => counts.reduce((a, b) => a + b, 0));
}

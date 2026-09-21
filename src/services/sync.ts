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
import type { Trade, JournalEntry, Strategy } from '../types';

// ─── Push local pending changes to Supabase ─────────────────────────────────

async function pushPendingTrades(): Promise<void> {
  // Push both pending and previously errored records
  const pending = await db.trades
    .filter(t => t._sync_status === 'pending' || t._sync_status === 'error')
    .toArray();

  for (const trade of pending) {
    try {
      if (trade._deleted_at) {
        // Delete from cloud
        const { error } = await supabase.from('trades').delete().eq('id', trade.id);
        if (!error) {
          // Safe to physically remove locally now
          await db.trades.delete(trade.id);
        } else {
          console.warn('Failed to push trade deletion:', trade.id, error.message);
          await db.trades.update(trade.id, { _sync_status: 'error' });
        }
      } else {
        // Upsert to cloud (strip local-only fields)
        const { _sync_status, _updated_at, _deleted_at, ...cloudRecord } = trade;
        const { error } = await supabase.from('trades').upsert(cloudRecord);
        if (!error) {
          await db.trades.update(trade.id, { _sync_status: 'synced' });
        } else {
          console.warn('Failed to push trade upsert:', trade.id, error.message);
          await db.trades.update(trade.id, { _sync_status: 'error' });
        }
      }
    } catch (err) {
      console.warn('Exception during pushPendingTrades:', trade.id, err);
      await db.trades.update(trade.id, { _sync_status: 'error' });
    }
  }
}

async function pushPendingJournalEntries(): Promise<void> {
  const pending = await db.journal_entries
    .filter(e => e._sync_status === 'pending' || e._sync_status === 'error')
    .toArray();

  for (const entry of pending) {
    try {
      if (entry._deleted_at) {
        const { error } = await supabase.from('journal_entries').delete().eq('id', entry.id);
        if (!error) {
          await db.journal_entries.delete(entry.id);
        } else {
          console.warn('Failed to push journal deletion:', entry.id, error.message);
          await db.journal_entries.update(entry.id, { _sync_status: 'error' });
        }
      } else {
        const { _sync_status, _updated_at, _deleted_at, ...cloudRecord } = entry;
        const { error } = await supabase.from('journal_entries').upsert(cloudRecord);
        if (!error) {
          await db.journal_entries.update(entry.id, { _sync_status: 'synced' });
        } else {
          console.warn('Failed to push journal upsert:', entry.id, error.message);
          await db.journal_entries.update(entry.id, { _sync_status: 'error' });
        }
      }
    } catch (err) {
      console.warn('Exception during pushPendingJournalEntries:', entry.id, err);
      await db.journal_entries.update(entry.id, { _sync_status: 'error' });
    }
  }
}

async function pushPendingStrategies(): Promise<void> {
  const pending = await db.strategies
    .filter(s => s._sync_status === 'pending' || s._sync_status === 'error')
    .toArray();

  for (const strategy of pending) {
    try {
      if (strategy._deleted_at) {
        const { error } = await supabase.from('strategies').delete().eq('id', strategy.id);
        if (!error) {
          await db.strategies.delete(strategy.id);
        } else {
          console.warn('Failed to push strategy deletion:', strategy.id, error.message);
          await db.strategies.update(strategy.id, { _sync_status: 'error' });
        }
      } else {
        const { _sync_status, _updated_at, _deleted_at, ...cloudRecord } = strategy;
        const { error } = await supabase.from('strategies').upsert(cloudRecord);
        if (!error) {
          await db.strategies.update(strategy.id, { _sync_status: 'synced' });
        } else {
          console.warn('Failed to push strategy upsert:', strategy.id, error.message);
          await db.strategies.update(strategy.id, { _sync_status: 'error' });
        }
      }
    } catch (err) {
      console.warn('Exception during pushPendingStrategies:', strategy.id, err);
      await db.strategies.update(strategy.id, { _sync_status: 'error' });
    }
  }
}

// ─── Realtime Ingestion Helpers ─────────────────────────────────────────────

export async function ingestRemoteTrade(cloudTrade: Trade): Promise<void> {
  const local = await db.trades.get(cloudTrade.id);
  if (local) {
    if (local._sync_status === 'pending') {
      const localTime = new Date(local._updated_at || local.updated_at || 0).getTime();
      const remoteTime = new Date(cloudTrade.updated_at || 0).getTime();
      if (remoteTime <= localTime) return; // Keep pending local change
    }
  }

  await db.trades.put({
    ...cloudTrade,
    _sync_status: 'synced',
    _updated_at: cloudTrade.updated_at,
    _deleted_at: null,
  });
}

export async function removeLocalTrade(tradeId: string): Promise<void> {
  const local = await db.trades.get(tradeId);
  // Do not delete if user has a pending unsynced edit locally
  if (local && local._sync_status === 'pending' && !local._deleted_at) {
    return;
  }
  await db.trades.delete(tradeId);
}

export async function ingestRemoteJournal(cloudEntry: JournalEntry): Promise<void> {
  const local = await db.journal_entries.get(cloudEntry.id);
  if (local) {
    if (local._sync_status === 'pending') {
      const localTime = new Date(local._updated_at || local.updated_at || 0).getTime();
      const remoteTime = new Date(cloudEntry.updated_at || 0).getTime();
      if (remoteTime <= localTime) return;
    }
  }

  await db.journal_entries.put({
    ...cloudEntry,
    _sync_status: 'synced',
    _updated_at: cloudEntry.updated_at,
    _deleted_at: null,
  });
}

export async function removeLocalJournal(entryId: string): Promise<void> {
  const local = await db.journal_entries.get(entryId);
  if (local && local._sync_status === 'pending' && !local._deleted_at) {
    return;
  }
  await db.journal_entries.delete(entryId);
}

export async function ingestRemoteStrategy(cloudStrategy: Strategy): Promise<void> {
  const local = await db.strategies.get(cloudStrategy.id);
  if (local) {
    if (local._sync_status === 'pending') {
      const localTime = new Date(local._updated_at || local.updated_at || 0).getTime();
      const remoteTime = new Date(cloudStrategy.updated_at || 0).getTime();
      if (remoteTime <= localTime) return;
    }
  }

  await db.strategies.put({
    ...cloudStrategy,
    _sync_status: 'synced',
    _updated_at: cloudStrategy.updated_at,
    _deleted_at: null,
  });
}

export async function removeLocalStrategy(strategyId: string): Promise<void> {
  const local = await db.strategies.get(strategyId);
  if (local && local._sync_status === 'pending' && !local._deleted_at) {
    return;
  }
  await db.strategies.delete(strategyId);
}

// ─── Pull from Supabase into IndexedDB ──────────────────────────────────────

async function pullTrades(workspaceId: string): Promise<void> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error || !data) {
    if (error) console.error('Error pulling trades from Supabase:', error.message);
    return;
  }

  const cloudIds = new Set<string>();

  for (const cloudTrade of data) {
    cloudIds.add(cloudTrade.id);
    const local = await db.trades.get(cloudTrade.id);

    // Conflict handling:
    // If local has pending change, check timestamps
    if (local && local._sync_status === 'pending') {
      const localTime = new Date(local._updated_at || local.updated_at || 0).getTime();
      const remoteTime = new Date(cloudTrade.updated_at || 0).getTime();
      // If local is newer or equal, preserve pending local edit
      if (remoteTime <= localTime) {
        continue;
      }
    }

    await db.trades.put({
      ...cloudTrade,
      _sync_status: 'synced' as const,
      _updated_at: cloudTrade.updated_at,
      _deleted_at: null,
    });
  }

  // Remote deletion reconciliation:
  // If a local record is marked 'synced' but is missing from Supabase,
  // it was deleted from another device. Clean it up locally so the devices stay identical.
  const localWorkspaceTrades = await db.trades
    .where('workspace_id')
    .equals(workspaceId)
    .toArray();

  for (const localTrade of localWorkspaceTrades) {
    if (localTrade._sync_status === 'synced' && !cloudIds.has(localTrade.id)) {
      await db.trades.delete(localTrade.id);
    }
  }
}

async function pullJournalEntries(workspaceId: string): Promise<void> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error || !data) {
    if (error) console.error('Error pulling journal entries from Supabase:', error.message);
    return;
  }

  const cloudIds = new Set<string>();

  for (const cloudEntry of data) {
    cloudIds.add(cloudEntry.id);
    const local = await db.journal_entries.get(cloudEntry.id);

    if (local && local._sync_status === 'pending') {
      const localTime = new Date(local._updated_at || local.updated_at || 0).getTime();
      const remoteTime = new Date(cloudEntry.updated_at || 0).getTime();
      if (remoteTime <= localTime) {
        continue;
      }
    }

    await db.journal_entries.put({
      ...cloudEntry,
      _sync_status: 'synced' as const,
      _updated_at: cloudEntry.updated_at,
      _deleted_at: null,
    });
  }

  // Remote deletion reconciliation
  const localWorkspaceEntries = await db.journal_entries
    .where('workspace_id')
    .equals(workspaceId)
    .toArray();

  for (const localEntry of localWorkspaceEntries) {
    if (localEntry._sync_status === 'synced' && !cloudIds.has(localEntry.id)) {
      await db.journal_entries.delete(localEntry.id);
    }
  }
}

async function pullStrategies(workspaceId: string): Promise<void> {
  const { data, error } = await supabase
    .from('strategies')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error || !data) {
    if (error) console.error('Error pulling strategies from Supabase:', error.message);
    return;
  }

  const cloudIds = new Set<string>();

  for (const cloudStrategy of data) {
    cloudIds.add(cloudStrategy.id);
    const local = await db.strategies.get(cloudStrategy.id);

    if (local && local._sync_status === 'pending') {
      const localTime = new Date(local._updated_at || local.updated_at || 0).getTime();
      const remoteTime = new Date(cloudStrategy.updated_at || 0).getTime();
      if (remoteTime <= localTime) {
        continue;
      }
    }

    await db.strategies.put({
      ...cloudStrategy,
      _sync_status: 'synced' as const,
      _updated_at: cloudStrategy.updated_at,
      _deleted_at: null,
    });
  }

  // Remote deletion reconciliation
  const localWorkspaceStrategies = await db.strategies
    .where('workspace_id')
    .equals(workspaceId)
    .toArray();

  for (const localStrategy of localWorkspaceStrategies) {
    if (localStrategy._sync_status === 'synced' && !cloudIds.has(localStrategy.id)) {
      await db.strategies.delete(localStrategy.id);
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function syncToCloud(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  // Use allSettled so one entity failure does not abort others
  await Promise.allSettled([
    pushPendingTrades(),
    pushPendingJournalEntries(),
    pushPendingStrategies(),
  ]);
}

export async function syncFromCloud(workspaceId: string): Promise<void> {
  if (!workspaceId) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  await Promise.allSettled([
    pullTrades(workspaceId),
    pullJournalEntries(workspaceId),
    pullStrategies(workspaceId),
  ]);
}

/**
 * Perform a full bidirectional synchronization.
 * Crucially, push and pull are decoupled so a failure in push (e.g. invalid offline draft)
 * never stops downloading fresh remote records from the cloud.
 */
export async function fullSync(workspaceId: string): Promise<void> {
  if (!workspaceId) return;

  await Promise.allSettled([
    syncToCloud(),
    syncFromCloud(workspaceId),
  ]);
}

export function getPendingCount(): Promise<number> {
  return Promise.all([
    db.trades.filter(t => t._sync_status === 'pending' || t._sync_status === 'error').count(),
    db.journal_entries.filter(e => e._sync_status === 'pending' || e._sync_status === 'error').count(),
    db.strategies.filter(s => s._sync_status === 'pending' || s._sync_status === 'error').count(),
  ]).then(counts => counts.reduce((a, b) => a + b, 0));
}

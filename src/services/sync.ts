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

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SyncPushResult {
  pushedCount: number;
  errors: string[];
}

export interface SyncPullResult {
  pulledCount: number;
  errors: string[];
}

export interface SyncResult {
  success: boolean;
  pushedCount: number;
  pulledCount: number;
  errors: string[];
  timestamp: string;
}

// ─── Push local pending changes to Supabase ─────────────────────────────────

async function pushPendingTrades(): Promise<{ pushed: number; errors: string[] }> {
  const pending = await db.trades
    .filter(t => t._sync_status === 'pending' || t._sync_status === 'error')
    .toArray();

  let pushed = 0;
  const errors: string[] = [];

  for (const trade of pending) {
    try {
      if (trade._deleted_at) {
        const { error } = await supabase.from('trades').delete().eq('id', trade.id);
        if (!error) {
          await db.trades.delete(trade.id);
          pushed++;
        } else {
          console.warn('Failed to push trade deletion:', trade.id, error.message);
          await db.trades.update(trade.id, { _sync_status: 'error' });
          errors.push(`Trade deletion error: ${error.message}`);
        }
      } else {
        const { _sync_status, _updated_at, _deleted_at, ...cloudRecord } = trade;
        const { error } = await supabase.from('trades').upsert(cloudRecord);
        if (!error) {
          await db.trades.update(trade.id, { _sync_status: 'synced' });
          pushed++;
        } else {
          console.warn('Failed to push trade upsert:', trade.id, error.message);
          await db.trades.update(trade.id, { _sync_status: 'error' });
          errors.push(`Trade upload error: ${error.message}`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('Exception during pushPendingTrades:', trade.id, err);
      await db.trades.update(trade.id, { _sync_status: 'error' });
      errors.push(`Trade sync exception: ${msg}`);
    }
  }

  return { pushed, errors };
}

async function pushPendingJournalEntries(): Promise<{ pushed: number; errors: string[] }> {
  const pending = await db.journal_entries
    .filter(e => e._sync_status === 'pending' || e._sync_status === 'error')
    .toArray();

  let pushed = 0;
  const errors: string[] = [];

  for (const entry of pending) {
    try {
      if (entry._deleted_at) {
        const { error } = await supabase.from('journal_entries').delete().eq('id', entry.id);
        if (!error) {
          await db.journal_entries.delete(entry.id);
          pushed++;
        } else {
          console.warn('Failed to push journal deletion:', entry.id, error.message);
          await db.journal_entries.update(entry.id, { _sync_status: 'error' });
          errors.push(`Journal deletion error: ${error.message}`);
        }
      } else {
        const { _sync_status, _updated_at, _deleted_at, ...cloudRecord } = entry;
        const { error } = await supabase.from('journal_entries').upsert(cloudRecord);
        if (!error) {
          await db.journal_entries.update(entry.id, { _sync_status: 'synced' });
          pushed++;
        } else {
          console.warn('Failed to push journal upsert:', entry.id, error.message);
          await db.journal_entries.update(entry.id, { _sync_status: 'error' });
          errors.push(`Journal upload error: ${error.message}`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('Exception during pushPendingJournalEntries:', entry.id, err);
      await db.journal_entries.update(entry.id, { _sync_status: 'error' });
      errors.push(`Journal sync exception: ${msg}`);
    }
  }

  return { pushed, errors };
}

async function pushPendingStrategies(): Promise<{ pushed: number; errors: string[] }> {
  const pending = await db.strategies
    .filter(s => s._sync_status === 'pending' || s._sync_status === 'error')
    .toArray();

  let pushed = 0;
  const errors: string[] = [];

  for (const strategy of pending) {
    try {
      if (strategy._deleted_at) {
        const { error } = await supabase.from('strategies').delete().eq('id', strategy.id);
        if (!error) {
          await db.strategies.delete(strategy.id);
          pushed++;
        } else {
          console.warn('Failed to push strategy deletion:', strategy.id, error.message);
          await db.strategies.update(strategy.id, { _sync_status: 'error' });
          errors.push(`Strategy deletion error: ${error.message}`);
        }
      } else {
        const { _sync_status, _updated_at, _deleted_at, ...cloudRecord } = strategy;
        const { error } = await supabase.from('strategies').upsert(cloudRecord);
        if (!error) {
          await db.strategies.update(strategy.id, { _sync_status: 'synced' });
          pushed++;
        } else {
          console.warn('Failed to push strategy upsert:', strategy.id, error.message);
          await db.strategies.update(strategy.id, { _sync_status: 'error' });
          errors.push(`Strategy upload error: ${error.message}`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('Exception during pushPendingStrategies:', strategy.id, err);
      await db.strategies.update(strategy.id, { _sync_status: 'error' });
      errors.push(`Strategy sync exception: ${msg}`);
    }
  }

  return { pushed, errors };
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

async function pullTrades(workspaceId: string): Promise<{ pulled: number; errors: string[] }> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error || !data) {
    const msg = error?.message ?? 'Unknown error fetching trades';
    console.error('Error pulling trades from Supabase:', msg);
    return { pulled: 0, errors: [msg] };
  }

  const cloudIds = new Set<string>();
  let pulled = 0;

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
    pulled++;
  }

  // Safe Remote Deletion Reconciliation:
  // If remote returns 0 records but local has multiple synced records, do NOT blindly delete all!
  // This safeguards against accidental RLS blocks or temporary query filter anomalies wiping data.
  const localWorkspaceTrades = await db.trades
    .where('workspace_id')
    .equals(workspaceId)
    .toArray();

  if (data.length > 0 || localWorkspaceTrades.length <= 1) {
    for (const localTrade of localWorkspaceTrades) {
      if (localTrade._sync_status === 'synced' && !cloudIds.has(localTrade.id)) {
        await db.trades.delete(localTrade.id);
      }
    }
  } else if (data.length === 0 && localWorkspaceTrades.length > 1) {
    console.warn('Protective guard: Remote trades returned 0 records while local has multiple. Skipping local deletion purge.');
  }

  return { pulled, errors: [] };
}

async function pullJournalEntries(workspaceId: string): Promise<{ pulled: number; errors: string[] }> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error || !data) {
    const msg = error?.message ?? 'Unknown error fetching journal entries';
    console.error('Error pulling journal entries from Supabase:', msg);
    return { pulled: 0, errors: [msg] };
  }

  const cloudIds = new Set<string>();
  let pulled = 0;

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
    pulled++;
  }

  // Safe Remote deletion reconciliation
  const localWorkspaceEntries = await db.journal_entries
    .where('workspace_id')
    .equals(workspaceId)
    .toArray();

  if (data.length > 0 || localWorkspaceEntries.length <= 1) {
    for (const localEntry of localWorkspaceEntries) {
      if (localEntry._sync_status === 'synced' && !cloudIds.has(localEntry.id)) {
        await db.journal_entries.delete(localEntry.id);
      }
    }
  }

  return { pulled, errors: [] };
}

async function pullStrategies(workspaceId: string): Promise<{ pulled: number; errors: string[] }> {
  const { data, error } = await supabase
    .from('strategies')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error || !data) {
    const msg = error?.message ?? 'Unknown error fetching strategies';
    console.error('Error pulling strategies from Supabase:', msg);
    return { pulled: 0, errors: [msg] };
  }

  const cloudIds = new Set<string>();
  let pulled = 0;

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
    pulled++;
  }

  // Safe Remote deletion reconciliation
  const localWorkspaceStrategies = await db.strategies
    .where('workspace_id')
    .equals(workspaceId)
    .toArray();

  if (data.length > 0 || localWorkspaceStrategies.length <= 1) {
    for (const localStrategy of localWorkspaceStrategies) {
      if (localStrategy._sync_status === 'synced' && !cloudIds.has(localStrategy.id)) {
        await db.strategies.delete(localStrategy.id);
      }
    }
  }

  return { pulled, errors: [] };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function syncToCloud(): Promise<SyncPushResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { pushedCount: 0, errors: ['Offline'] };
  }

  const results = await Promise.allSettled([
    pushPendingTrades(),
    pushPendingJournalEntries(),
    pushPendingStrategies(),
  ]);

  let pushedCount = 0;
  const errors: string[] = [];

  for (const res of results) {
    if (res.status === 'fulfilled') {
      pushedCount += res.value.pushed;
      errors.push(...res.value.errors);
    } else {
      errors.push(String(res.reason));
    }
  }

  return { pushedCount, errors };
}

export async function syncFromCloud(workspaceId: string): Promise<SyncPullResult> {
  if (!workspaceId) return { pulledCount: 0, errors: ['No workspace ID'] };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { pulledCount: 0, errors: ['Offline'] };
  }

  const results = await Promise.allSettled([
    pullTrades(workspaceId),
    pullJournalEntries(workspaceId),
    pullStrategies(workspaceId),
  ]);

  let pulledCount = 0;
  const errors: string[] = [];

  for (const res of results) {
    if (res.status === 'fulfilled') {
      pulledCount += res.value.pulled;
      errors.push(...res.value.errors);
    } else {
      errors.push(String(res.reason));
    }
  }

  return { pulledCount, errors };
}

/**
 * Perform a full bidirectional synchronization.
 * Push and pull are decoupled so an issue in push does not prevent pulling cloud updates.
 * Returns detailed SyncResult for UI state and telemetry.
 */
export async function fullSync(workspaceId: string): Promise<SyncResult> {
  const timestamp = new Date().toISOString();
  if (!workspaceId) {
    return {
      success: false,
      pushedCount: 0,
      pulledCount: 0,
      errors: ['No workspace provided'],
      timestamp,
    };
  }

  const [pushRes, pullRes] = await Promise.all([
    syncToCloud(),
    syncFromCloud(workspaceId),
  ]);

  const allErrors = [...pushRes.errors, ...pullRes.errors];
  const success = allErrors.length === 0;

  return {
    success,
    pushedCount: pushRes.pushedCount,
    pulledCount: pullRes.pulledCount,
    errors: allErrors,
    timestamp,
  };
}

export function getPendingCount(): Promise<number> {
  return Promise.all([
    db.trades.filter(t => t._sync_status === 'pending' || t._sync_status === 'error').count(),
    db.journal_entries.filter(e => e._sync_status === 'pending' || e._sync_status === 'error').count(),
    db.strategies.filter(s => s._sync_status === 'pending' || s._sync_status === 'error').count(),
  ]).then(counts => counts.reduce((a, b) => a + b, 0));
}


import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, withSyncMeta } from '../src/db';
import {
  syncToCloud,
  syncFromCloud,
  fullSync,
  getPendingCount,
  ingestRemoteTrade,
  removeLocalTrade,
} from '../src/services/sync';
import type { Trade } from '../src/types';

// Mock Supabase client
vi.mock('../src/services/supabase', () => {
  const remoteTrades: any[] = [];
  const remoteJournal: any[] = [];
  const remoteStrategies: any[] = [];

  const getStore = (table: string) => {
    if (table === 'trades') return remoteTrades;
    if (table === 'journal_entries') return remoteJournal;
    if (table === 'strategies') return remoteStrategies;
    return [];
  };

  const supabaseMock = {
    _remoteTrades: remoteTrades,
    _remoteJournal: remoteJournal,
    _remoteStrategies: remoteStrategies,
    from: vi.fn().mockImplementation((table: string) => {
      const store = getStore(table);
      let filterFn: ((item: any) => boolean) | null = null;

      const chain: any = {
        select: vi.fn().mockImplementation(() => chain),
        eq: vi.fn().mockImplementation((field: string, val: any) => {
          filterFn = (item: any) => item[field] === val;
          return chain;
        }),
        delete: vi.fn().mockImplementation(() => {
          return {
            eq: vi.fn().mockImplementation(async (field: string, val: any) => {
              const idx = store.findIndex(item => item[field] === val);
              if (idx !== -1) store.splice(idx, 1);
              return { error: null };
            }),
          };
        }),
        upsert: vi.fn().mockImplementation(async (record: any) => {
          const idx = store.findIndex(item => item.id === record.id);
          if (idx !== -1) {
            store[idx] = { ...record };
          } else {
            store.push({ ...record });
          }
          return { error: null };
        }),
        then: (resolve: (val: any) => any, reject?: (reason: any) => any) => {
          let results = [...store];
          if (filterFn) {
            results = results.filter(filterFn);
          }
          return Promise.resolve({ data: results, error: null }).then(resolve, reject);
        },
      };

      return chain;
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
  };

  return { supabase: supabaseMock };
});

import { supabase } from '../src/services/supabase';

function makeTrade(id: string, overrides: Partial<Trade> = {}): Trade {
  return {
    id,
    workspace_id: 'ws-cross-device',
    user_id: 'user-computer',
    asset: 'BTCUSDT',
    market: 'Crypto',
    direction: 'long',
    status: 'closed',
    result: 'tp',
    pnl: 150,
    trade_date: '2026-09-21',
    strategy_id: null,
    entry_price: 60000,
    exit_price: 62000,
    stop_loss: 59000,
    take_profit: 62000,
    position_size: 1,
    leverage: 1,
    fees: 2,
    session: null,
    entry_reason: 'Breakout',
    exit_reason: 'Target hit',
    emotion: 'confident',
    confidence: 8,
    followed_plan: true,
    review: null,
    screenshot_before: 'ws-cross-device/trade-1/before.jpg',
    screenshot_after: 'ws-cross-device/trade-1/after.jpg',
    visibility: 'shared',
    created_at: '2026-09-21T10:00:00.000Z',
    updated_at: '2026-09-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('Cross-Device Data Synchronization Engine', () => {
  beforeEach(async () => {
    // Clear local Dexie tables
    await db.trades.clear();
    await db.journal_entries.clear();
    await db.strategies.clear();

    // Clear remote mock store
    (supabase as any)._remoteTrades.length = 0;
    (supabase as any)._remoteJournal.length = 0;
    (supabase as any)._remoteStrategies.length = 0;
  });

  it('1. Create trade locally -> marks as pending sync -> uploads to Supabase -> marks synced', async () => {
    const trade = makeTrade('trade-local-1');

    // Save to IndexedDB as pending (just like AddTradePage does)
    await db.trades.put(withSyncMeta(trade, 'pending'));

    expect(await getPendingCount()).toBe(1);
    const localBefore = await db.trades.get('trade-local-1');
    expect(localBefore?._sync_status).toBe('pending');

    // Run push sync to cloud
    await syncToCloud();

    // Pending count drops to 0, local is now synced
    expect(await getPendingCount()).toBe(0);
    const localAfter = await db.trades.get('trade-local-1');
    expect(localAfter?._sync_status).toBe('synced');

    // Verify record exists in remote Supabase store
    expect((supabase as any)._remoteTrades.length).toBe(1);
    expect((supabase as any)._remoteTrades[0].id).toBe('trade-local-1');
    expect((supabase as any)._remoteTrades[0].screenshot_before).toBe('ws-cross-device/trade-1/before.jpg');
  });

  it('2. Fresh/new device (empty IndexedDB) pulls all existing cloud trades upon authentication', async () => {
    // Simulate computer already populated cloud with 2 trades
    (supabase as any)._remoteTrades.push(
      makeTrade('cloud-trade-1', { asset: 'ETHUSDT', pnl: 85 }),
      makeTrade('cloud-trade-2', { asset: 'SOLUSDT', pnl: -30 })
    );

    // Mobile device opens with completely empty IndexedDB
    const countBefore = await db.trades.count();
    expect(countBefore).toBe(0);

    // Mobile runs syncFromCloud for the workspace
    await syncFromCloud('ws-cross-device');

    // Mobile local IndexedDB is now populated
    const mobileTrades = await db.trades.toArray();
    expect(mobileTrades.length).toBe(2);

    const eth = mobileTrades.find(t => t.id === 'cloud-trade-1');
    expect(eth).toBeDefined();
    expect(eth?.asset).toBe('ETHUSDT');
    expect(eth?.pnl).toBe(85);
    expect(eth?._sync_status).toBe('synced');

    const sol = mobileTrades.find(t => t.id === 'cloud-trade-2');
    expect(sol).toBeDefined();
    expect(sol?.asset).toBe('SOLUSDT');
    expect(sol?.pnl).toBe(-30);
    expect(sol?._sync_status).toBe('synced');
  });

  it('3. Reverse direction: Mobile saves trade -> uploads to Supabase -> Computer pulls it', async () => {
    // Mobile writes trade
    const mobileTrade = makeTrade('mobile-trade-1', { user_id: 'user-mobile', asset: 'XAUUSD', pnl: 320 });
    await db.trades.put(withSyncMeta(mobileTrade, 'pending'));
    await syncToCloud();

    expect((supabase as any)._remoteTrades.length).toBe(1);
    expect((supabase as any)._remoteTrades[0].asset).toBe('XAUUSD');

    // Now simulate Computer device: empty or existing cache, pulling cloud
    await db.trades.clear(); // computer cache before pull
    await syncFromCloud('ws-cross-device');

    const computerTrades = await db.trades.toArray();
    expect(computerTrades.length).toBe(1);
    expect(computerTrades[0].id).toBe('mobile-trade-1');
    expect(computerTrades[0].asset).toBe('XAUUSD');
    expect(computerTrades[0].pnl).toBe(320);
  });

  it('4. Remote deletion reconciliation: trade deleted remotely is removed from local cache', async () => {
    // Trade exists locally and is marked synced
    const trade = makeTrade('trade-to-be-deleted-remotely');
    await db.trades.put({
      ...trade,
      _sync_status: 'synced',
      _updated_at: trade.updated_at,
      _deleted_at: null,
    });

    // Cloud does NOT contain this trade (e.g. deleted from another device)
    (supabase as any)._remoteTrades.length = 0;

    // Pull from cloud
    await syncFromCloud('ws-cross-device');

    // Local IndexedDB has reconciled and removed the deleted trade
    const local = await db.trades.get('trade-to-be-deleted-remotely');
    expect(local).toBeUndefined();
  });

  it('5. Pending local changes are NOT overwritten by older remote data (conflict safety)', async () => {
    const originalTrade = makeTrade('trade-conflict-1', {
      pnl: 100,
      updated_at: '2026-09-21T11:00:00.000Z',
    });

    // Cloud has older version
    (supabase as any)._remoteTrades.push({ ...originalTrade });

    // Local has newer pending edit
    await db.trades.put({
      ...originalTrade,
      pnl: 250, // User edited pnl offline to 250
      _sync_status: 'pending',
      _updated_at: '2026-09-21T11:05:00.000Z', // newer
      _deleted_at: null,
    });

    // Pull from cloud
    await syncFromCloud('ws-cross-device');

    // Local pending edit remains untouched!
    const local = await db.trades.get('trade-conflict-1');
    expect(local?._sync_status).toBe('pending');
    expect(local?.pnl).toBe(250);
  });

  it('6. Realtime ingestion: ingestRemoteTrade and removeLocalTrade update local IndexedDB immediately', async () => {
    const liveTrade = makeTrade('live-realtime-trade', { asset: 'DOGEUSDT', pnl: 40 });

    // Ingest event
    await ingestRemoteTrade(liveTrade);

    let local = await db.trades.get('live-realtime-trade');
    expect(local).toBeDefined();
    expect(local?.asset).toBe('DOGEUSDT');
    expect(local?._sync_status).toBe('synced');

    // Delete event
    await removeLocalTrade('live-realtime-trade');
    local = await db.trades.get('live-realtime-trade');
    expect(local).toBeUndefined();
  });

  it('7. Decoupled fullSync: push errors do not block downloading cloud data to fresh device', async () => {
    // Cloud has existing data
    (supabase as any)._remoteTrades.push(makeTrade('cloud-existing-trade'));

    // Create a local draft with pending status
    await db.trades.put({
      ...makeTrade('local-pending-trade'),
      _sync_status: 'pending',
      _updated_at: new Date().toISOString(),
      _deleted_at: null,
    });

    // Make upsert fail to simulate a network or validation error on push
    const originalUpsert = supabase.from('trades').upsert;
    (supabase.from('trades') as any).upsert = vi.fn().mockResolvedValue({
      error: { message: 'Network timeout during push' },
    });

    // fullSync should settle both and pull the remote record even though push had an error
    await fullSync('ws-cross-device');

    const remotePulled = await db.trades.get('cloud-existing-trade');
    expect(remotePulled).toBeDefined();
    expect(remotePulled?._sync_status).toBe('synced');

    // Restore upsert
    (supabase.from('trades') as any).upsert = originalUpsert;
  });
});

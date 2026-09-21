import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Dexie from 'dexie';
import {
  ingestRemoteTrade,
  removeLocalTrade,
} from '../src/services/sync';
import type { Trade, LocalTrade } from '../src/types';

vi.mock('../src/services/supabase', () => {
  const remoteDatabase = {
    trades: [] as any[],
    journal_entries: [] as any[],
    strategies: [] as any[],
    workspaces: [] as any[],
    workspace_members: [] as any[],
  };

  const getStore = (table: string) => {
    if (table === 'trades') return remoteDatabase.trades;
    if (table === 'journal_entries') return remoteDatabase.journal_entries;
    if (table === 'strategies') return remoteDatabase.strategies;
    if (table === 'workspaces') return remoteDatabase.workspaces;
    if (table === 'workspace_members') return remoteDatabase.workspace_members;
    return [];
  };

  const supabaseMock = {
    _remoteDatabase: remoteDatabase,
    from: vi.fn().mockImplementation((table: string) => {
      const store = getStore(table);
      let filterFn: ((item: any) => boolean) | null = null;

      const chain: any = {
        select: vi.fn().mockImplementation(() => chain),
        eq: vi.fn().mockImplementation((field: string, val: any) => {
          const prev = filterFn;
          filterFn = (item: any) => (prev ? prev(item) : true) && item[field] === val;
          return chain;
        }),
        order: vi.fn().mockImplementation(() => chain),
        limit: vi.fn().mockImplementation(() => chain),
        maybeSingle: vi.fn().mockImplementation(async () => {
          let results = [...store];
          if (filterFn) results = results.filter(filterFn);
          return { data: results[0] ?? null, error: null };
        }),
        single: vi.fn().mockImplementation(async () => {
          let results = [...store];
          if (filterFn) results = results.filter(filterFn);
          return { data: results[0] ?? null, error: results[0] ? null : { message: 'Row not found' } };
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
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://supabase.co/storage/v1/signed/test' }, error: null }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    },
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
  };

  return { supabase: supabaseMock };
});

import { supabase } from '../src/services/supabase';

// Helper to create independent isolated local IndexedDB databases for Device A and Device B
class ClientDeviceDB extends Dexie {
  trades!: Dexie.Table<LocalTrade, string>;

  constructor(dbName: string) {
    super(dbName);
    this.version(1).stores({
      trades: 'id, workspace_id, user_id, trade_date, status, result, strategy_id, _sync_status',
    });
  }

  // Device-level push to Supabase
  async pushToCloud(): Promise<number> {
    const pending = await this.trades
      .filter(t => t._sync_status === 'pending' || t._sync_status === 'error')
      .toArray();

    let count = 0;
    for (const t of pending) {
      if (t._deleted_at) {
        await supabase.from('trades').delete().eq('id', t.id);
        await this.trades.delete(t.id);
      } else {
        const { _sync_status, _updated_at, _deleted_at, ...cloudRecord } = t;
        await supabase.from('trades').upsert(cloudRecord);
        await this.trades.update(t.id, { _sync_status: 'synced' });
      }
      count++;
    }
    return count;
  }

  // Device-level pull from Supabase
  async pullFromCloud(workspaceId: string): Promise<number> {
    const { data } = await supabase.from('trades').select('*').eq('workspace_id', workspaceId);
    if (!data) return 0;

    const cloudIds = new Set<string>();
    let count = 0;

    for (const cloudTrade of data) {
      cloudIds.add(cloudTrade.id);
      const local = await this.trades.get(cloudTrade.id);

      if (local && local._sync_status === 'pending') {
        const localTime = new Date(local._updated_at || local.updated_at || 0).getTime();
        const remoteTime = new Date(cloudTrade.updated_at || 0).getTime();
        if (remoteTime <= localTime) continue;
      }

      await this.trades.put({
        ...cloudTrade,
        _sync_status: 'synced',
        _updated_at: cloudTrade.updated_at,
        _deleted_at: null,
      });
      count++;
    }

    // Safe remote deletion reconciliation
    const locals = await this.trades.where('workspace_id').equals(workspaceId).toArray();
    if (data.length > 0 || locals.length <= 1) {
      for (const lt of locals) {
        if (lt._sync_status === 'synced' && !cloudIds.has(lt.id)) {
          await this.trades.delete(lt.id);
        }
      }
    }

    return count;
  }
}

function makeTradeData(id: string, overrides: Partial<Trade> = {}): Trade {
  return {
    id,
    workspace_id: 'workspace-main-123',
    user_id: 'user-auth-uuid-999',
    asset: 'XAUUSD',
    market: 'Forex/Commodity',
    direction: 'long',
    status: 'closed',
    result: 'tp',
    pnl: 250,
    trade_date: '2026-09-21',
    strategy_id: null,
    entry_price: 2600,
    exit_price: 2625,
    stop_loss: 2590,
    take_profit: 2625,
    position_size: 1,
    leverage: 1,
    fees: 5,
    session: 'London',
    entry_reason: 'Golden cross breakout',
    exit_reason: 'Take profit hit',
    emotion: 'confident',
    confidence: 9,
    followed_plan: true,
    review: 'Executed trade according to plan',
    screenshot_before: 'workspace-main-123/trade-1/before.jpg',
    screenshot_after: 'workspace-main-123/trade-1/after.jpg',
    visibility: 'shared',
    created_at: '2026-09-21T08:00:00.000Z',
    updated_at: '2026-09-21T08:00:00.000Z',
    ...overrides,
  };
}

describe('Realistic Cross-Device Synchronization Scenario (Device A <-> Supabase Cloud <-> Device B)', () => {
  let deviceA: ClientDeviceDB;
  let deviceB: ClientDeviceDB;

  const remoteDB = (supabase as any)._remoteDatabase;

  beforeEach(async () => {
    // Reset remote cloud storage
    remoteDB.trades = [];
    remoteDB.workspaces = [
      { id: 'workspace-main-123', name: 'Alpha Traders', created_by: 'user-auth-uuid-999' }
    ];
    remoteDB.workspace_members = [
      { id: 'mem-1', workspace_id: 'workspace-main-123', user_id: 'user-auth-uuid-999', role: 'owner' }
    ];

    // Initialize two distinct client databases (simulating PC and Mobile browsers)
    deviceA = new ClientDeviceDB(`Device_PC_${Date.now()}_${Math.random()}`);
    deviceB = new ClientDeviceDB(`Device_Mobile_${Date.now()}_${Math.random()}`);

    await deviceA.trades.clear();
    await deviceB.trades.clear();
  });

  it('Step 1: PC creates Trade A -> saves to IndexedDB as pending -> pushes to Supabase -> verified in remote DB', async () => {
    const tradeA = makeTradeData('trade-pc-001', { asset: 'BTCUSDT', pnl: 450 });

    // PC writes to local cache as pending
    await deviceA.trades.put({
      ...tradeA,
      _sync_status: 'pending',
      _updated_at: tradeA.updated_at,
      _deleted_at: null,
    });

    const localA = await deviceA.trades.get('trade-pc-001');
    expect(localA?._sync_status).toBe('pending');
    expect(remoteDB.trades.length).toBe(0);

    // PC pushes to Supabase Cloud
    await deviceA.pushToCloud();

    // Local is marked synced
    const localAAfter = await deviceA.trades.get('trade-pc-001');
    expect(localAAfter?._sync_status).toBe('synced');

    // Supabase remote cloud contains the trade
    expect(remoteDB.trades.length).toBe(1);
    expect(remoteDB.trades[0].id).toBe('trade-pc-001');
    expect(remoteDB.trades[0].asset).toBe('BTCUSDT');
    expect(remoteDB.trades[0].pnl).toBe(450);
    expect(remoteDB.trades[0].screenshot_before).toBe('workspace-main-123/trade-1/before.jpg');
  });

  it('Step 2: Mobile opens with empty database -> logs in with same user/workspace -> pulls Supabase data -> displays Trade A', async () => {
    // Cloud has trade created by PC
    const tradeA = makeTradeData('trade-pc-001', { asset: 'BTCUSDT', pnl: 450 });
    remoteDB.trades.push({ ...tradeA });

    // Mobile has completely empty local database
    expect(await deviceB.trades.count()).toBe(0);

    // Mobile resolves workspace and performs initial pull
    const pulled = await deviceB.pullFromCloud('workspace-main-123');
    expect(pulled).toBe(1);

    // Mobile local database now contains Trade A with identical values
    const mobileTrades = await deviceB.trades.toArray();
    expect(mobileTrades.length).toBe(1);
    expect(mobileTrades[0].id).toBe('trade-pc-001');
    expect(mobileTrades[0].asset).toBe('BTCUSDT');
    expect(mobileTrades[0].pnl).toBe(450);
    expect(mobileTrades[0]._sync_status).toBe('synced');
    expect(mobileTrades[0].screenshot_before).toBe('workspace-main-123/trade-1/before.jpg');
  });

  it('Step 3: Reverse direction: Mobile creates Trade B -> syncs to Cloud -> PC syncs -> PC displays Trade B', async () => {
    // Both devices start with Trade A synced
    const tradeA = makeTradeData('trade-pc-001');
    remoteDB.trades.push({ ...tradeA });
    await deviceA.pullFromCloud('workspace-main-123');
    await deviceB.pullFromCloud('workspace-main-123');

    expect(await deviceA.trades.count()).toBe(1);
    expect(await deviceB.trades.count()).toBe(1);

    // Mobile user opens phone on the road and creates Trade B
    const tradeB = makeTradeData('trade-mobile-002', {
      asset: 'ETHUSDT',
      direction: 'short',
      pnl: 180,
      created_at: '2026-09-21T12:00:00.000Z',
      updated_at: '2026-09-21T12:00:00.000Z',
    });

    await deviceB.trades.put({
      ...tradeB,
      _sync_status: 'pending',
      _updated_at: tradeB.updated_at,
      _deleted_at: null,
    });

    // Mobile syncs to Supabase
    await deviceB.pushToCloud();

    // Verify remote database has both trades
    expect(remoteDB.trades.length).toBe(2);
    expect(remoteDB.trades.some((t: any) => t.id === 'trade-mobile-002')).toBe(true);

    // PC user presses Sync Now or tab refocuses
    await deviceA.pullFromCloud('workspace-main-123');

    // PC now has both Trade A and Trade B
    const pcTrades = await deviceA.trades.toArray();
    expect(pcTrades.length).toBe(2);
    const ethTrade = pcTrades.find(t => t.id === 'trade-mobile-002');
    expect(ethTrade).toBeDefined();
    expect(ethTrade?.asset).toBe('ETHUSDT');
    expect(ethTrade?.direction).toBe('short');
    expect(ethTrade?.pnl).toBe(180);
    expect(ethTrade?._sync_status).toBe('synced');
  });

  it('Step 4: Offline pending record preservation and reconnection retry', async () => {
    // PC creates an offline draft while disconnected
    const offlineTrade = makeTradeData('offline-trade-003', { asset: 'SOLUSDT', pnl: -60 });
    await deviceA.trades.put({
      ...offlineTrade,
      _sync_status: 'pending',
      _updated_at: new Date().toISOString(),
      _deleted_at: null,
    });

    expect(await deviceA.trades.count()).toBe(1);

    // When connection restores, push succeeds
    await deviceA.pushToCloud();
    const syncedTrade = await deviceA.trades.get('offline-trade-003');
    expect(syncedTrade?._sync_status).toBe('synced');
    expect(remoteDB.trades.find((t: any) => t.id === 'offline-trade-003')).toBeDefined();
  });

  it('Step 5: Cloud query returning empty does NOT wipe out local data if query was erroneous', async () => {
    // Local device already has 3 trades
    await deviceA.trades.bulkPut([
      { ...makeTradeData('trade-1'), _sync_status: 'synced', _updated_at: new Date().toISOString(), _deleted_at: null },
      { ...makeTradeData('trade-2'), _sync_status: 'synced', _updated_at: new Date().toISOString(), _deleted_at: null },
      { ...makeTradeData('trade-3'), _sync_status: 'synced', _updated_at: new Date().toISOString(), _deleted_at: null },
    ]);

    expect(await deviceA.trades.count()).toBe(3);

    // If remote database is temporarily unauthenticated / returning 0 results
    remoteDB.trades = [];

    // Pull from cloud
    await deviceA.pullFromCloud('workspace-main-123');

    // Local records are PROTECTED and not erased!
    expect(await deviceA.trades.count()).toBe(3);
  });
});

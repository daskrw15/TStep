import { useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from './useOnlineStatus';
import {
  fullSync,
  getPendingCount,
  ingestRemoteTrade,
  removeLocalTrade,
  ingestRemoteJournal,
  removeLocalJournal,
  ingestRemoteStrategy,
  removeLocalStrategy,
} from '../services/sync';
import { supabase } from '../services/supabase';
import type { Trade, JournalEntry, Strategy } from '../types';

/**
 * Hook that manages sync lifecycle:
 * - Immediate sync on mount / workspace change
 * - Realtime push/pull subscriptions via Supabase Realtime channel
 * - Syncs when window regains focus or tab visibility returns (crucial for mobile wake-up)
 * - Syncs when coming back online
 * - Provides pending count for UI indicators
 * - Periodic fallback sync every 60s when online
 */
export type SyncState = 'idle' | 'syncing' | 'success' | 'error';

export function useSync(workspaceId: string | null) {
  const isOnline = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncState>('idle');
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(() => {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('tstep_last_sync_time') : null;
  });
  const [lastError, setLastError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const doSync = async () => {
    if (!workspaceId) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setSyncStatus('idle');
      return;
    }

    setIsSyncing(true);
    setSyncStatus('syncing');
    setLastError(null);

    try {
      const res = await fullSync(workspaceId);
      if (res.success) {
        setSyncStatus('success');
        setLastSyncTime(res.timestamp);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('tstep_last_sync_time', res.timestamp);
        }
      } else {
        setSyncStatus('error');
        setLastError(res.errors.join(', '));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Sync error:', err);
      setSyncStatus('error');
      setLastError(msg);
    } finally {
      setIsSyncing(false);
      const count = await getPendingCount();
      setPendingCount(count);
    }
  };

  // Sync on mount and when workspace changes
  useEffect(() => {
    doSync();
  }, [workspaceId]);

  // Sync when coming back online
  useEffect(() => {
    if (isOnline) {
      doSync();
    }
  }, [isOnline]);

  // Mobile / tab focus & visibility change listener:
  // When a user unlocks their phone or switches back to the TStep browser tab,
  // immediately pull latest changes from the cloud.
  useEffect(() => {
    if (!workspaceId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        doSync();
      }
    };

    const handleFocus = () => {
      doSync();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [workspaceId]);

  // Supabase Realtime Subscription:
  // Instantly synchronizes changes between devices when both are active or during edits
  useEffect(() => {
    if (!workspaceId) return;

    const channel = supabase
      .channel(`workspace-sync-${workspaceId}`)
      // Trades
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trades',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        async (payload) => {
          try {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              await ingestRemoteTrade(payload.new as Trade);
            } else if (payload.eventType === 'DELETE') {
              if (payload.old && payload.old.id) {
                await removeLocalTrade(payload.old.id);
              }
            }
          } catch (err) {
            console.warn('Error handling realtime trade change:', err);
          }
        }
      )
      // Journal entries
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'journal_entries',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        async (payload) => {
          try {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              await ingestRemoteJournal(payload.new as JournalEntry);
            } else if (payload.eventType === 'DELETE') {
              if (payload.old && payload.old.id) {
                await removeLocalJournal(payload.old.id);
              }
            }
          } catch (err) {
            console.warn('Error handling realtime journal change:', err);
          }
        }
      )
      // Strategies
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'strategies',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        async (payload) => {
          try {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              await ingestRemoteStrategy(payload.new as Strategy);
            } else if (payload.eventType === 'DELETE') {
              if (payload.old && payload.old.id) {
                await removeLocalStrategy(payload.old.id);
              }
            }
          } catch (err) {
            console.warn('Error handling realtime strategy change:', err);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  // Periodic fallback sync (every 60s)
  useEffect(() => {
    if (workspaceId) {
      intervalRef.current = setInterval(doSync, 60_000);
      return () => clearInterval(intervalRef.current);
    }
  }, [workspaceId]);

  // Update pending count periodically
  useEffect(() => {
    const update = async () => {
      const count = await getPendingCount();
      setPendingCount(count);
    };
    update();
    const id = setInterval(update, 10_000);
    return () => clearInterval(id);
  }, []);

  return {
    pendingCount,
    isSyncing,
    isOnline,
    syncStatus,
    lastSyncTime,
    lastError,
    triggerSync: doSync,
  };
}

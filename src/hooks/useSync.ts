import { useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from './useOnlineStatus';
import { fullSync, getPendingCount } from '../services/sync';

/**
 * Hook that manages sync lifecycle:
 * - Syncs on mount
 * - Syncs when coming back online
 * - Provides pending count for UI indicators
 * - Periodic sync every 60s when online
 */
export function useSync(workspaceId: string | null) {
  const isOnline = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const doSync = async () => {
    if (!workspaceId || !navigator.onLine) return;
    setIsSyncing(true);
    try {
      await fullSync(workspaceId);
    } catch (err) {
      console.error('Sync error:', err);
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

  // Periodic sync
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

  return { pendingCount, isSyncing, isOnline, triggerSync: doSync };
}

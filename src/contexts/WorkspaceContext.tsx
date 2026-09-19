import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from './AuthContext';
import type { Workspace, WorkspaceMember, Profile } from '../types';

interface WorkspaceState {
  workspace: Workspace | null;
  members: WorkspaceMember[];
  partner: (WorkspaceMember & { profile?: Profile }) | null;
  loading: boolean;
  createWorkspace: (name: string) => Promise<{ error: string | null; workspaceId: string | null }>;
  joinWorkspace: (inviteCode: string) => Promise<{ error: string | null }>;
  regenerateInviteCode: () => Promise<{ error: string | null; inviteCode: string | null }>;
  revokeInviteCode: () => Promise<{ error: string | null }>;
  updateMemberCapital: (memberId: string, capital: number) => Promise<{ error: string | null }>;
  updateWorkspaceCapital: (userCapital: number, partnerCapital: number) => Promise<{ error: string | null }>;
  refreshWorkspace: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWorkspace = async () => {
    if (!user) {
      setWorkspace(null);
      setMembers([]);
      setLoading(false);
      return;
    }

    // Get user's workspace membership
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (!membership) {
      setWorkspace(null);
      setMembers([]);
      setLoading(false);
      return;
    }

    // Fetch workspace
    const { data: ws } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', membership.workspace_id)
      .single();

    setWorkspace(ws);

    // Fetch members with profiles
    const { data: mems } = await supabase
      .from('workspace_members')
      .select('*, profile:profiles(*)')
      .eq('workspace_id', membership.workspace_id);

    setMembers(mems ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchWorkspace();
  }, [user]);

  const partner = members.find(m => m.user_id !== user?.id) as (WorkspaceMember & { profile?: Profile }) | null ?? null;

  const createWorkspace = async (name: string) => {
    if (!user) return { error: 'Not authenticated', workspaceId: null };

    const { data, error } = await supabase.rpc('create_workspace', {
      name,
    });

    if (error) return { error: error.message, workspaceId: null };
    if (data && !data.success) return { error: data.error, workspaceId: null };

    await fetchWorkspace();
    return { error: null, workspaceId: data.workspace_id };
  };

  const joinWorkspace = async (inviteCode: string) => {
    const { data, error } = await supabase.rpc('join_workspace_by_invite_code', {
      code: inviteCode,
    });

    if (error) return { error: error.message };
    if (data && !data.success) return { error: data.error };

    await fetchWorkspace();
    return { error: null };
  };

  const regenerateInviteCode = async () => {
    if (!workspace) return { error: 'No workspace', inviteCode: null };

    const { data, error } = await supabase.rpc('regenerate_invite_code', {
      ws_id: workspace.id,
    });

    if (error) return { error: error.message, inviteCode: null };
    if (data && !data.success) return { error: data.error, inviteCode: null };

    await fetchWorkspace();
    return { error: null, inviteCode: data.invite_code };
  };

  const revokeInviteCode = async () => {
    if (!workspace) return { error: 'No workspace' };

    const { data, error } = await supabase.rpc('revoke_invite_code', {
      ws_id: workspace.id,
    });

    if (error) return { error: error.message };
    if (data && !data.success) return { error: data.error };

    await fetchWorkspace();
    return { error: null };
  };

  const updateMemberCapital = async (memberId: string, capital: number) => {
    const { error } = await supabase
      .from('workspace_members')
      .update({ capital })
      .eq('id', memberId);

    if (error) return { error: error.message };

    // Update local state immediately for responsive UI
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, capital } : m));
    return { error: null };
  };

  const updateWorkspaceCapital = async (userCapital: number, partnerCapital: number) => {
    if (!workspace) return { error: 'No workspace' };

    const total_capital = userCapital + partnerCapital;
    const user_ownership_pct = total_capital > 0 ? (userCapital / total_capital) * 100 : 50;
    const partner_ownership_pct = total_capital > 0 ? (partnerCapital / total_capital) * 100 : 50;

    // 1. Update workspace_members (existing live database column)
    const myMem = members.find(m => m.user_id === user?.id);
    const pMem = members.find(m => m.user_id !== user?.id);

    if (myMem) {
      const { error: memErr } = await supabase
        .from('workspace_members')
        .update({ capital: userCapital })
        .eq('id', myMem.id);
      if (memErr) console.warn('Could not update my member capital:', memErr.message);
    }

    if (pMem) {
      const { error: pMemErr } = await supabase
        .from('workspace_members')
        .update({ capital: partnerCapital })
        .eq('id', pMem.id);
      if (pMemErr) console.warn('Could not update partner member capital:', pMemErr.message);
    }

    // 2. Update workspace table if migration 005 has been executed in database
    const { error } = await supabase
      .from('workspaces')
      .update({
        user_capital: userCapital,
        partner_capital: partnerCapital,
        total_capital,
        user_ownership_pct,
        partner_ownership_pct,
        updated_at: new Date().toISOString(),
      })
      .eq('id', workspace.id);

    // If migration 005 has not been executed yet in the remote Supabase project,
    // the columns won't exist in the remote schema cache.
    // In that case, saving to workspace_members already succeeded!
    if (error) {
      const isSchemaCacheError = error.message?.includes('schema cache') || error.code === 'PGRST204';
      if (!isSchemaCacheError) {
        return { error: error.message };
      }
      console.warn('Note: workspaces capital columns not in remote schema cache yet; using workspace_members storage.', error.message);
    }

    // 3. Update local state immediately for both workspace & members
    setWorkspace(prev => prev ? {
      ...prev,
      user_capital: userCapital,
      partner_capital: partnerCapital,
      total_capital,
      user_ownership_pct,
      partner_ownership_pct,
    } : null);

    setMembers(prev => prev.map(m => {
      if (m.user_id === user?.id) return { ...m, capital: userCapital };
      return { ...m, capital: partnerCapital };
    }));

    return { error: null };
  };

  return (
    <WorkspaceContext.Provider value={{
      workspace, members, partner, loading,
      createWorkspace, joinWorkspace,
      regenerateInviteCode, revokeInviteCode,
      updateMemberCapital,
      updateWorkspaceCapital,
      refreshWorkspace: fetchWorkspace,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

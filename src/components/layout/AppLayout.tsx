import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSync } from '../../hooks/useSync';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export default function AppLayout() {
  const { workspace } = useWorkspace();
  const { pendingCount, isOnline, isSyncing, syncStatus, lastSyncTime, triggerSync } = useSync(workspace?.id ?? null);
  const { isInstallable, installApp } = usePWAInstall();
  const navigate = useNavigate();

  const formatShortTime = (iso: string | null) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const syncTimeStr = formatShortTime(lastSyncTime);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">TStep</div>

        <nav className="sidebar-nav">
          <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">🏠</span> ภาพรวม
          </NavLink>
          <NavLink to="/trades" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">📝</span> รายการเทรด
          </NavLink>
          <NavLink to="/statistics" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">📊</span> สถิติ
          </NavLink>
          <NavLink to="/journal" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">❤️</span> บันทึกคู่เทรด
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">⚙️</span> ตั้งค่า
          </NavLink>
        </nav>

        {isInstallable && (
          <div style={{ padding: '0 var(--space-4)', marginBottom: 'var(--space-3)' }}>
            <button
              className="btn btn-secondary btn-sm"
              style={{ width: '100%', borderColor: 'var(--color-primary)', color: 'var(--color-primary-light)' }}
              onClick={installApp}
            >
              📲 ติดตั้งแอพ TStep
            </button>
          </div>
        )}

        <div className="sidebar-cta">
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => navigate('/trades/new')}>
            ＋ เพิ่มรายการเทรด
          </button>
        </div>

        <div className="sidebar-footer">
          <button
            className="connection-bar"
            style={{
              width: '100%',
              background: 'transparent',
              border: '1px solid var(--color-border-subtle)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-secondary)',
              transition: 'background var(--transition-fast)',
            }}
            onClick={triggerSync}
            disabled={isSyncing}
            title={lastSyncTime ? `ซิงค์ล่าสุด: ${new Date(lastSyncTime).toLocaleString('th-TH')} (คลิกเพื่อซิงค์ทันที)` : 'คลิกเพื่อบังคับซิงค์ข้อมูลกับคลาวด์ทันที'}
          >
            <span className={`connection-dot ${isOnline ? 'online' : 'offline'}`} />
            <span style={{ fontSize: 'var(--text-xs)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span>{isSyncing ? 'กำลังซิงค์…' : syncStatus === 'error' ? 'ซิงค์ผิดพลาด' : isOnline ? 'ออนไลน์' : 'ออฟไลน์'}</span>
              {syncTimeStr && !isSyncing && (
                <span style={{ fontSize: '10px', opacity: 0.6 }}>ซิงค์ล่าสุด {syncTimeStr}</span>
              )}
            </span>
            {pendingCount > 0 ? (
              <span className="badge badge-sync" style={{ marginLeft: 'auto', fontSize: '10px' }}>
                รอส่ง {pendingCount}
              </span>
            ) : (
              <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', opacity: 0.6 }}>
                {isSyncing ? '⏳' : syncStatus === 'error' ? '⚠️' : '🔄'}
              </span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Mobile Header Bar */}
        <div className="mobile-header">
          <div className="mobile-header-title">TStep</div>
          <div className="flex items-center gap-2">
            {isInstallable && (
              <button
                className="btn btn-primary btn-sm"
                style={{ padding: '4px 10px', fontSize: 'var(--text-xs)' }}
                onClick={installApp}
              >
                📲 ติดตั้ง
              </button>
            )}
            <button
              className="connection-bar"
              style={{
                padding: '4px 8px',
                fontSize: 'var(--text-xs)',
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border-subtle)',
                cursor: 'pointer',
                borderRadius: 'var(--radius-full)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              onClick={triggerSync}
              disabled={isSyncing}
              title={lastSyncTime ? `ซิงค์ล่าสุด: ${new Date(lastSyncTime).toLocaleString('th-TH')}` : 'แตะเพื่อซิงค์ข้อมูลทันที'}
            >
              <span className={`connection-dot ${isOnline ? 'online' : 'offline'}`} />
              <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                {isSyncing ? 'กำลังซิงค์…' : syncStatus === 'error' ? 'ลองใหม่' : syncTimeStr ? `ซิงค์ ${syncTimeStr}` : 'ซิงค์'}
              </span>
              {pendingCount > 0 ? (
                <span className="badge badge-sync" style={{ padding: '1px 5px', fontSize: '9px' }}>
                  {pendingCount}
                </span>
              ) : (
                <span style={{ fontSize: '10px', opacity: 0.7 }}>
                  {isSyncing ? '⏳' : syncStatus === 'error' ? '⚠️' : '🔄'}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="content-container">
          <Outlet />
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="mobile-nav">
        <div className="mobile-nav-inner">
          <NavLink to="/" end className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
            <span className="mobile-nav-item-icon">🏠</span>
            ภาพรวม
          </NavLink>
          <NavLink to="/trades" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
            <span className="mobile-nav-item-icon">📝</span>
            รายการเทรด
          </NavLink>
          <button className="mobile-add-btn" onClick={() => navigate('/trades/new')} aria-label="เพิ่มรายการเทรด">＋</button>
          <NavLink to="/statistics" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
            <span className="mobile-nav-item-icon">📊</span>
            สถิติ
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
            <span className="mobile-nav-item-icon">⋯</span>
            ตั้งค่า
          </NavLink>
        </div>
      </nav>
    </>
  );
}

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSync } from '../../hooks/useSync';
import { useWorkspace } from '../../contexts/WorkspaceContext';

export default function AppLayout() {
  const { workspace } = useWorkspace();
  const { pendingCount, isOnline } = useSync(workspace?.id ?? null);
  const navigate = useNavigate();

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">TradeTogether</div>

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

        <div className="sidebar-cta">
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => navigate('/trades/new')}>
            ＋ เพิ่มรายการเทรด
          </button>
        </div>

        <div className="sidebar-footer">
          <div className="connection-bar">
            <span className={`connection-dot ${isOnline ? 'online' : 'offline'}`} />
            {isOnline ? 'ออนไลน์' : 'ออฟไลน์'}
            {pendingCount > 0 && (
              <span className="badge badge-sync" style={{ marginLeft: 'auto' }}>
                รอซิงค์ {pendingCount} รายการ
              </span>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
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

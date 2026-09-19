import React, { useState } from 'react';
import { useWorkspace } from '../../contexts/WorkspaceContext';

export default function OnboardingPage() {
  const { createWorkspace, joinWorkspace } = useWorkspace();
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');
  const [workspaceName, setWorkspaceName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!workspaceName.trim()) {
      setError('กรุณาระบุชื่อพื้นที่เทรด');
      return;
    }
    setLoading(true);
    const result = await createWorkspace(workspaceName.trim());
    setLoading(false);
    if (result.error) setError(result.error);
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!inviteCode.trim()) {
      setError('กรุณาระบุรหัสคำเชิญ');
      return;
    }
    setLoading(true);
    const result = await joinWorkspace(inviteCode.trim());
    setLoading(false);
    if (result.error) setError(result.error);
  };

  if (mode === 'choose') {
    return (
      <div className="onboarding-page">
        <div className="onboarding-card">
          <div className="auth-logo">ยินดีต้อนรับสู่ TradeTogether</div>
          <div className="auth-tagline">มาเริ่มต้นตั้งค่าพื้นที่เทรดของคุณกัน</div>

          <div className="onboarding-options">
            <button className="onboarding-option" onClick={() => setMode('create')}>
              <span className="onboarding-option-icon">✨</span>
              <div>
                <div className="onboarding-option-title">สร้างพื้นที่เทรด (Workspace)</div>
                <div className="onboarding-option-desc">เริ่มต้นใหม่ แล้วชวนคู่เทรดมาร่วมกันภายหลัง</div>
              </div>
            </button>

            <button className="onboarding-option" onClick={() => setMode('join')}>
              <span className="onboarding-option-icon">🤝</span>
              <div>
                <div className="onboarding-option-title">เข้าร่วมพื้นที่เทรด</div>
                <div className="onboarding-option-desc">มีรหัสคำเชิญที่ได้รับจากคู่เทรดแล้ว</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'create') {
    return (
      <div className="onboarding-page">
        <div className="onboarding-card">
          <div className="auth-logo">สร้างพื้นที่เทรด (Workspace)</div>
          <div className="auth-tagline">ตั้งชื่อให้กับพื้นที่เทรดร่วมกันของคุณ</div>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleCreate} className="flex flex-col gap-4 mt-6">
            <div className="form-group">
              <label htmlFor="wsName">ชื่อพื้นที่เทรด (Workspace Name)</label>
              <input
                id="wsName"
                type="text"
                value={workspaceName}
                onChange={e => setWorkspaceName(e.target.value)}
                placeholder="เช่น การเทรดของเรา, Alpha Duo"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary btn-lg" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'กำลังสร้าง…' : 'สร้างพื้นที่เทรด'}
            </button>

            <button type="button" className="btn btn-ghost" onClick={() => { setMode('choose'); setError(''); }}>
              ← ย้อนกลับ
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        <div className="auth-logo">เข้าร่วมพื้นที่เทรด</div>
        <div className="auth-tagline">กรอกรหัสคำเชิญที่ได้รับจากคู่เทรดของคุณ</div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleJoin} className="flex flex-col gap-4 mt-6">
          <div className="form-group">
            <label htmlFor="code">รหัสคำเชิญ (Invite Code)</label>
            <input
              id="code"
              type="text"
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value.toUpperCase())}
              placeholder="เช่น A1B2C3D4"
              required
              maxLength={10}
              style={{ textAlign: 'center', letterSpacing: '0.15em', fontSize: '1.25rem', fontWeight: 600 }}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-lg" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'กำลังเข้าร่วม…' : 'เข้าร่วมพื้นที่เทรด'}
          </button>

          <button type="button" className="btn btn-ghost" onClick={() => { setMode('choose'); setError(''); }}>
            ← ย้อนกลับ
          </button>
        </form>
      </div>
    </div>
  );
}

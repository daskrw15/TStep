import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, withSyncMeta } from '../../db';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { syncToCloud } from '../../services/sync';
import { exportAsJSON, exportAsCSV, downloadFile, importFromJSON, validateImportData, type ImportResult } from '../../services/dataExport';
import { CURRENCIES, type Currency, type Strategy, type LocalStrategy } from '../../types';

export default function SettingsPage() {
  const { user, profile, updateProfile, signOut } = useAuth();
  const { workspace, partner, members, regenerateInviteCode, revokeInviteCode, updateWorkspaceCapital } = useWorkspace();

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [currency, setCurrency] = useState<Currency>(profile?.preferred_currency ?? 'THB');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Capital settings state
  const myMem = members.find(m => m.user_id === user?.id);
  const pMem = members.find(m => m.user_id !== user?.id);

  const initialUserCap = workspace?.user_capital != null
    ? workspace.user_capital
    : (myMem?.capital != null ? myMem.capital : 0);

  const initialPartnerCap = workspace?.partner_capital != null
    ? workspace.partner_capital
    : (pMem?.capital != null ? pMem.capital : 0);

  const [userCapitalInput, setUserCapitalInput] = useState(initialUserCap.toString());
  const [partnerCapitalInput, setPartnerCapitalInput] = useState(initialPartnerCap.toString());
  const [savingCapital, setSavingCapital] = useState(false);
  const [capitalMessage, setCapitalMessage] = useState('');

  // Synchronize inputs if workspace / members load asynchronously
  useEffect(() => {
    if (workspace?.user_capital != null) {
      setUserCapitalInput(workspace.user_capital.toString());
    } else if (myMem?.capital != null) {
      setUserCapitalInput(myMem.capital.toString());
    }

    if (workspace?.partner_capital != null) {
      setPartnerCapitalInput(workspace.partner_capital.toString());
    } else if (pMem?.capital != null) {
      setPartnerCapitalInput(pMem.capital.toString());
    }
  }, [workspace?.user_capital, workspace?.partner_capital, myMem?.capital, pMem?.capital]);

  // Strategy management
  const [newStrategy, setNewStrategy] = useState('');
  const strategies = useLiveQuery<LocalStrategy[]>(
    () => workspace
      ? db.strategies.where('workspace_id').equals(workspace.id).filter(s => !s._deleted_at).toArray()
      : [],
    [workspace?.id]
  );

  // Import
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSaveProfile = async () => {
    setSaving(true);
    setMessage('');
    const result = await updateProfile({
      display_name: displayName.trim(),
      preferred_currency: currency,
    });
    setSaving(false);
    setMessage(result.error ?? 'บันทึกข้อมูลเรียบร้อยแล้ว!');
  };

  const handleAddStrategy = async () => {
    if (!workspace || !newStrategy.trim()) return;
    const strategyData: Strategy = {
      id: crypto.randomUUID(),
      workspace_id: workspace.id,
      name: newStrategy.trim(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await db.strategies.put(withSyncMeta(strategyData, 'pending'));
    syncToCloud().catch(() => {});
    setNewStrategy('');
  };

  const handleDeleteStrategy = async (id: string) => {
    await db.strategies.update(id, {
      _sync_status: 'pending',
      _deleted_at: new Date().toISOString(),
      _updated_at: new Date().toISOString(),
    });
    syncToCloud().catch(() => {});
  };

  const handleExportJSON = async () => {
    if (!workspace) return;
    const json = await exportAsJSON(workspace.id);
    downloadFile(json, `tradetogether-export-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  };

  const handleExportCSV = async () => {
    if (!workspace) return;
    const csv = await exportAsCSV(workspace.id);
    downloadFile(csv, `tradetogether-trades-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspace || !user) return;

    const text = await file.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { setImportResult({ tradesImported: 0, journalEntriesImported: 0, tradesSkipped: 0, journalEntriesSkipped: 0, errors: ['ไฟล์ JSON ไม่ถูกต้อง'] }); return; }

    const validation = validateImportData(parsed);
    if (!validation.valid) {
      setImportResult({ tradesImported: 0, journalEntriesImported: 0, tradesSkipped: 0, journalEntriesSkipped: 0, errors: [validation.error ?? 'การตรวจสอบข้อมูลล้มเหลว'] });
      return;
    }

    if (!confirm(`ต้องการนำเข้าข้อมูลรายการเทรด ${validation.data!.trades.length} รายการ และบันทึกไดอารี่ ${validation.data!.journal_entries.length} รายการ หรือไม่? (ข้อมูลที่มีอยู่แล้วจะไม่ถูกเขียนทับ)`)) {
      return;
    }

    const result = await importFromJSON(text, workspace.id, user.id);
    setImportResult(result);
    syncToCloud().catch(() => {});
  };

  const handleRegenerateCode = async () => {
    const result = await regenerateInviteCode();
    if (result.error) setMessage(result.error);
  };

  const handleRevokeCode = async () => {
    if (!confirm('ยืนยันที่จะยกเลิกรหัสคำเชิญนี้หรือไม่? คู่เทรดจะไม่สามารถใช้รหัสเดิมเพื่อเข้าร่วมได้')) return;
    const result = await revokeInviteCode();
    if (result.error) setMessage(result.error);
  };

  return (
    <div>
      <h1 className="page-title mb-6">ตั้งค่า</h1>

      {message && <div className="auth-error mb-4" style={{ background: message === 'บันทึกข้อมูลเรียบร้อยแล้ว!' ? 'var(--color-positive-bg)' : undefined, color: message === 'บันทึกข้อมูลเรียบร้อยแล้ว!' ? 'var(--color-positive)' : undefined }}>{message}</div>}

      {/* Profile */}
      <div className="settings-section">
        <h2 className="settings-section-title">โปรไฟล์ผู้ใช้ (Profile)</h2>
        <div className="form-group">
          <label htmlFor="sDisplayName">ชื่อที่แสดง</label>
          <input id="sDisplayName" value={displayName} onChange={e => setDisplayName(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="sCurrency">สกุลเงินหลักที่แสดง</label>
          <select id="sCurrency" value={currency} onChange={e => setCurrency(e.target.value as Currency)}>
            {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.symbol} {c.label}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={handleSaveProfile} disabled={saving}>
          {saving ? 'กำลังบันทึก…' : 'บันทึกข้อมูลโปรไฟล์'}
        </button>
      </div>

      {/* Partner / Workspace */}
      <div className="settings-section">
        <h2 className="settings-section-title">พื้นที่เทรด (Workspace)</h2>
        {workspace && (
          <>
            <div className="settings-row">
              <span className="settings-row-label">ชื่อพื้นที่เทรด</span>
              <span>{workspace.name}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">สมาชิก</span>
              <span>{members.length} / 2 คน</span>
            </div>
            {partner ? (
              <div className="settings-row">
                <span className="settings-row-label">คู่เทรด</span>
                <span>{partner.profile?.display_name || 'คู่เทรด'}</span>
              </div>
            ) : (
              <div className="card card-compact mt-4">
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>เชิญคู่เทรดของคุณ</div>
                {workspace.invite_code ? (
                  <>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>ส่งรหัสคำเชิญนี้ให้คู่เทรด:</div>
                    <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '0.15em', fontFamily: 'var(--font-mono)', textAlign: 'center', padding: 'var(--space-4)', background: 'var(--color-bg-input)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-3)' }}>
                      {workspace.invite_code}
                    </div>
                    <div className="flex gap-2">
                      <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(workspace.invite_code!)}>คัดลอกรหัส</button>
                      <button className="btn btn-ghost btn-sm" onClick={handleRegenerateCode}>สร้างรหัสใหม่</button>
                      <button className="btn btn-ghost btn-sm" onClick={handleRevokeCode}>ยกเลิกรหัส</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>รหัสคำเชิญถูกยกเลิกแล้ว</div>
                    <button className="btn btn-secondary btn-sm mt-2" onClick={handleRegenerateCode}>สร้างรหัสคำเชิญใหม่</button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Capital & Ownership Configuration */}
      <div className="settings-section">
        <h2 className="settings-section-title">ตั้งค่าเงินทุนและสัดส่วน (Capital & Ownership)</h2>
        <p className="text-muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-4)' }}>
          กำหนดเงินทุนเริ่มต้นของคุณและคู่เทรด (หน่วยเป็นเงินบาท THB) เพื่อคำนวณสัดส่วนความเป็นเจ้าของอัตโนมัติ
        </p>

        {capitalMessage && (
          <div className="auth-error mb-4" style={{
            background: capitalMessage.includes('เรียบร้อย') ? 'var(--color-positive-bg)' : undefined,
            color: capitalMessage.includes('เรียบร้อย') ? 'var(--color-positive)' : undefined
          }}>
            {capitalMessage}
          </div>
        )}

        <div className="form-row mb-4">
          <div className="form-group">
            <label htmlFor="userCap">เงินทุนของคุณ (฿ THB)</label>
            <input
              id="userCap"
              type="number"
              min="0"
              step="any"
              value={userCapitalInput}
              onChange={e => setUserCapitalInput(e.target.value)}
              placeholder="เช่น 60000"
            />
          </div>
          <div className="form-group">
            <label htmlFor="partnerCap">เงินทุนของคู่เทรด (฿ THB)</label>
            <input
              id="partnerCap"
              type="number"
              min="0"
              step="any"
              value={partnerCapitalInput}
              onChange={e => setPartnerCapitalInput(e.target.value)}
              placeholder="เช่น 40000"
            />
          </div>
        </div>

        {/* Real-time Calculation Preview */}
        {(() => {
          const uCap = Math.max(0, Number(userCapitalInput) || 0);
          const pCap = Math.max(0, Number(partnerCapitalInput) || 0);
          const total = uCap + pCap;
          const uPct = total > 0 ? (uCap / total) * 100 : 50;
          const pPct = total > 0 ? (pCap / total) * 100 : 50;
          return (
            <div className="card card-compact mb-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>สรุปการคำนวณสัดส่วน:</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                <span style={{ fontWeight: 600 }}>เงินทุนรวม:</span>
                <span style={{ fontWeight: 700, fontSize: 'var(--text-lg)', color: 'var(--color-text-primary)' }}>฿{total.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginBottom: '4px' }}>
                <span>คุณ: ฿{uCap.toLocaleString()}</span>
                <span style={{ fontWeight: 700, color: 'var(--color-accent)' }}>{uPct.toFixed(1)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                <span>คู่เทรด: ฿{pCap.toLocaleString()}</span>
                <span style={{ fontWeight: 700, color: '#a855f7' }}>{pPct.toFixed(1)}%</span>
              </div>
            </div>
          );
        })()}

        <button
          className="btn btn-primary"
          disabled={savingCapital || !workspace}
          onClick={async () => {
            setSavingCapital(true);
            setCapitalMessage('');
            const uCap = Math.max(0, Number(userCapitalInput) || 0);
            const pCap = Math.max(0, Number(partnerCapitalInput) || 0);

            const res = await updateWorkspaceCapital(uCap, pCap);
            setSavingCapital(false);
            if (res.error) {
              setCapitalMessage(`บันทึกเงินทุนไม่สำเร็จ: ${res.error}`);
            } else {
              setCapitalMessage('บันทึกเงินทุนและสัดส่วนพื้นที่เทรดเรียบร้อยแล้ว!');
            }
          }}
        >
          {savingCapital ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่าเงินทุน'}
        </button>
      </div>

      {/* Strategies */}
      <div className="settings-section">
        <h2 className="settings-section-title">กลยุทธ์การเทรด (Strategies)</h2>
        <div className="flex gap-2 mb-4">
          <input
            value={newStrategy}
            onChange={e => setNewStrategy(e.target.value)}
            placeholder="เช่น Breakout, S/R Bounce, Scalping"
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddStrategy())}
          />
          <button className="btn btn-secondary" onClick={handleAddStrategy}>เพิ่มกลยุทธ์</button>
        </div>
        {(strategies ?? []).map(s => (
          <div key={s.id} className="settings-row">
            <span>{s.name}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteStrategy(s.id)}>ลบ</button>
          </div>
        ))}
        {(strategies ?? []).length === 0 && (
          <div className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>ยังไม่มีกลยุทธ์ที่บันทึกไว้ สามารถเพิ่มได้จากด้านบน</div>
        )}
      </div>

      {/* Data Export/Import */}
      <div className="settings-section">
        <h2 className="settings-section-title">จัดการข้อมูลสำรอง (Data Backup)</h2>
        <div className="flex gap-3 mb-4">
          <button className="btn btn-secondary" onClick={handleExportJSON}>ส่งออกเป็น JSON</button>
          <button className="btn btn-secondary" onClick={handleExportCSV}>ส่งออกเป็น CSV</button>
        </div>
        <div className="form-group">
          <label>นำเข้าข้อมูลสำรอง (ไฟล์ JSON)</label>
          <input type="file" accept=".json" ref={fileInputRef} onChange={handleImport} />
        </div>
        {importResult && (
          <div className="card card-compact mt-2" style={{ fontSize: 'var(--text-sm)' }}>
            <div>รายการเทรดที่นำเข้าสำเร็จ: {importResult.tradesImported} (ข้าม: {importResult.tradesSkipped})</div>
            <div>บันทึกไดอารี่ที่นำเข้าสำเร็จ: {importResult.journalEntriesImported} (ข้าม: {importResult.journalEntriesSkipped})</div>
            {importResult.errors.length > 0 && (
              <div className="text-negative mt-2">{importResult.errors.join(', ')}</div>
            )}
          </div>
        )}
      </div>

      {/* Sign Out */}
      <div className="settings-section">
        <button className="btn btn-danger" onClick={signOut}>ออกจากระบบ</button>
        <div className="text-muted mt-2" style={{ fontSize: 'var(--text-xs)' }}>
          ข้อมูลในเครื่องของคุณจะยังคงอยู่ และข้อมูลที่รอซิงค์จะถูกอัปเดตขึ้นคลาวด์เมื่อเข้าสู่ระบบอีกครั้ง
        </div>
      </div>
    </div>
  );
}

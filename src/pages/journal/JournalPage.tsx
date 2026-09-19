import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, withSyncMeta } from '../../db';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { syncToCloud } from '../../services/sync';
import { format } from 'date-fns';
import type { JournalEntry, LocalJournalEntry } from '../../types';

export default function JournalPage() {
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [entryDate, setEntryDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);

  const entries = useLiveQuery<LocalJournalEntry[]>(
    () => workspace
      ? db.journal_entries
          .where('workspace_id').equals(workspace.id)
          .filter(e => !e._deleted_at)
          .toArray()
          .then(arr => arr.sort((a, b) => b.entry_date.localeCompare(a.entry_date)))
      : [],
    [workspace?.id]
  );

  const resetForm = () => {
    setTitle('');
    setContent('');
    setEntryDate(format(new Date(), 'yyyy-MM-dd'));
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (entry: JournalEntry & { _sync_status?: string }) => {
    setTitle(entry.title);
    setContent(entry.content);
    setEntryDate(entry.entry_date);
    setEditingId(entry.id);
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !user || !title.trim()) return;

    setSaving(true);
    const now = new Date().toISOString();

    const entryData: JournalEntry = {
      id: editingId ?? crypto.randomUUID(),
      workspace_id: workspace.id,
      user_id: user.id,
      title: title.trim(),
      content: content.trim(),
      entry_date: entryDate,
      created_at: editingId ? (entries?.find(e => e.id === editingId)?.created_at ?? now) : now,
      updated_at: now,
    };

    await db.journal_entries.put(withSyncMeta(entryData, 'pending'));
    syncToCloud().catch(() => {});

    setSaving(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('ยืนยันที่จะลบบันทึกไดอารี่นี้หรือไม่?')) return;
    await db.journal_entries.update(id, {
      _sync_status: 'pending',
      _deleted_at: new Date().toISOString(),
      _updated_at: new Date().toISOString(),
    });
    syncToCloud().catch(() => {});
  };

  // Group by month
  const grouped = (entries ?? []).reduce<Record<string, typeof entries>>((acc, entry) => {
    if (!entry) return acc;
    const monthKey = entry.entry_date.substring(0, 7); // YYYY-MM
    if (!acc[monthKey]) acc[monthKey] = [];
    acc[monthKey]!.push(entry);
    return acc;
  }, {});

  if (!entries) return <div className="loading-page"><div className="loading-spinner" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="page-title">❤️ บันทึกคู่เทรด</h1>
          <p className="page-subtitle">บันทึกเรื่องราวและเส้นทางการเทรดร่วมกันของเรา</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>＋ เพิ่มบันทึก</button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="card mb-6">
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div className="form-group">
              <label htmlFor="jTitle">หัวข้อบันทึก</label>
              <input id="jTitle" value={title} onChange={e => setTitle(e.target.value)} placeholder="เช่น สรุปผลการเทรดประจำเดือนกันยายน" required />
            </div>
            <div className="form-group">
              <label htmlFor="jContent">เนื้อหา</label>
              <textarea id="jContent" value={content} onChange={e => setContent(e.target.value)} placeholder="เขียนความรู้สึก ข้อคิด หรือบันทึกของคุณที่นี่…" rows={4} />
            </div>
            <div className="form-group">
              <label htmlFor="jDate">วันที่</label>
              <input id="jDate" type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'กำลังบันทึก…' : editingId ? 'อัปเดตบันทึก' : 'บันทึก'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={resetForm}>ยกเลิก</button>
            </div>
          </form>
        </div>
      )}

      {/* Empty State */}
      {entries.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-icon">❤️</div>
          <div className="empty-state-title">ยังไม่มีบันทึกเรื่องราว</div>
          <div className="empty-state-text">เริ่มเขียนบันทึกเกี่ยวกับการเดินทางบนเส้นทางการเทรดของคุณทั้งสองคน</div>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>＋ เขียนบันทึกแรก</button>
        </div>
      )}

      {/* Timeline */}
      {Object.entries(grouped).map(([monthKey, monthEntries]) => (
        <div key={monthKey} className="mb-8">
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-6)' }}>
            {format(new Date(monthKey + '-01'), 'MMMM yyyy')}
          </h2>
          {(monthEntries ?? []).map(entry => (
            <div key={entry.id} className="journal-entry">
              <div className="journal-date">
                {format(new Date(entry.entry_date), 'MMM d')}
                {entry._sync_status === 'pending' && <span className="badge badge-sync" style={{ marginLeft: 'var(--space-2)' }}>รอซิงค์</span>}
              </div>
              <div className="journal-title">{entry.title}</div>
              {entry.content && <div className="journal-content">{entry.content}</div>}
              {entry.user_id === user?.id && (
                <div className="flex gap-2 mt-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(entry)}>แก้ไข</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(entry.id)}>ลบ</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

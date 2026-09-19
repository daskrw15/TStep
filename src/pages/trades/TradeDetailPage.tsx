import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { useAuth } from '../../contexts/AuthContext';
import { syncToCloud } from '../../services/sync';
import { getScreenshotUrl, deleteScreenshot } from '../../services/storage';
import { calculatePnL, calculateRMultiple, formatCurrency, formatR } from '../../utils/trading';
import { EMOTION_LABELS, STATUS_LABELS, RESULT_LABELS } from '../../locales/translations';
import { format } from 'date-fns';

export default function TradeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const currency = profile?.preferred_currency ?? 'THB';

  const trade = useLiveQuery(() => id ? db.trades.get(id) : undefined, [id]);
  const strategy = useLiveQuery(
    () => trade?.strategy_id ? db.strategies.get(trade.strategy_id) : undefined,
    [trade?.strategy_id]
  );

  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (trade?.screenshot_before) {
      getScreenshotUrl(trade.screenshot_before).then(setBeforeUrl);
    }
    if (trade?.screenshot_after) {
      getScreenshotUrl(trade.screenshot_after).then(setAfterUrl);
    }
  }, [trade?.screenshot_before, trade?.screenshot_after]);

  if (trade === undefined) return <div className="loading-page"><div className="loading-spinner" /></div>;
  if (trade === null) return <div className="empty-state"><div className="empty-state-title">ไม่พบข้อมูลการเทรดนี้</div></div>;

  const pnl = calculatePnL(trade);
  const rMultiple = calculateRMultiple(trade);
  const isOwner = trade.user_id === user?.id;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await db.trades.update(trade.id, {
        _sync_status: 'pending',
        _deleted_at: new Date().toISOString(),
        _updated_at: new Date().toISOString(),
      });
      if (trade.screenshot_before) {
        deleteScreenshot(trade.screenshot_before).catch(() => {});
      }
      if (trade.screenshot_after) {
        deleteScreenshot(trade.screenshot_after).catch(() => {});
      }
      syncToCloud().catch(() => {});
      setShowDeleteConfirm(false);
      navigate('/trades');
    } catch (err) {
      console.error('Error deleting trade:', err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <button className="btn btn-ghost btn-sm mb-2" onClick={() => navigate('/trades')}>← กลับหน้ารายการเทรด</button>
          <h1 className="page-title">{trade.asset}</h1>
          <div className="flex items-center gap-2 mt-2">
            <span className={`badge ${trade.direction === 'long' ? 'badge-long' : 'badge-short'}`}>
              {trade.direction.toUpperCase()}
            </span>
            <span className={`badge ${trade.status === 'closed' ? 'badge-neutral' : trade.status === 'waiting' ? 'badge-neutral' : 'badge-sync'}`}>
              {STATUS_LABELS[trade.status] ?? trade.status}
            </span>
            {trade.result && trade.result !== 'none' && (
              <span className={`badge ${trade.result === 'tp' ? 'badge-positive' : trade.result === 'sl' ? 'badge-negative' : 'badge-neutral'}`}>
                {RESULT_LABELS[trade.result] ?? trade.result.toUpperCase()}
              </span>
            )}
            {trade.visibility === 'private' && <span className="badge badge-neutral">🔒 ส่วนตัว</span>}
            {trade._sync_status === 'pending' && <span className="badge badge-sync">รอซิงค์</span>}
          </div>
        </div>
        {isOwner && (
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/trades/${trade.id}/edit`)}>แก้ไข</button>
            <button className="btn btn-danger btn-sm" onClick={() => setShowDeleteConfirm(true)} disabled={deleting}>ลบ</button>
          </div>
        )}
      </div>

      {/* Result */}
      <div className="grid-3 mb-6">
        <div className="stat-card">
          <div className="stat-card-label">P&L</div>
          <div className={`stat-card-value ${(pnl ?? 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
            {pnl != null ? formatCurrency(pnl, currency) : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">R-Multiple</div>
          <div className={`stat-card-value ${(rMultiple ?? 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
            {formatR(rMultiple)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">วันที่เทรด</div>
          <div className="stat-card-value" style={{ fontSize: 'var(--text-lg)' }}>
            {format(new Date(trade.trade_date), 'MMM d, yyyy')}
          </div>
        </div>
      </div>

      {/* Trade Details */}
      <div className="card mb-6">
        <div className="grid-2">
          <div>
            <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>ราคาเข้า (Entry)</div>
            <div style={{ fontWeight: 600 }}>{trade.entry_price ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>ราคาออก (Exit)</div>
            <div style={{ fontWeight: 600 }}>{trade.exit_price ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>Stop Loss</div>
            <div>{trade.stop_loss ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>Take Profit</div>
            <div>{trade.take_profit ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>ขนาดสถานะ (Position Size)</div>
            <div>{trade.position_size ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>Leverage</div>
            <div>{trade.leverage ? `${trade.leverage}x` : '—'}</div>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>ค่าธรรมเนียม (Fees)</div>
            <div>{trade.fees ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>ช่วงเวลาเทรด (Session)</div>
            <div>{trade.session ?? '—'}</div>
          </div>
        </div>
      </div>

      {/* Strategy */}
      {strategy && (
        <div className="card mb-6">
          <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>กลยุทธ์ (Strategy)</div>
          <div style={{ fontWeight: 600 }}>{strategy.name}</div>
        </div>
      )}

      {/* Reasoning */}
      {(trade.entry_reason || trade.exit_reason) && (
        <div className="card mb-6">
          {trade.entry_reason && (
            <div className="mb-4">
              <div className="text-muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)' }}>เหตุผลในการเข้าสถานะ (Entry Reason)</div>
              <div style={{ fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap' }}>{trade.entry_reason}</div>
            </div>
          )}
          {trade.exit_reason && (
            <div>
              <div className="text-muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)' }}>เหตุผลในการออกสถานะ (Exit Reason)</div>
              <div style={{ fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap' }}>{trade.exit_reason}</div>
            </div>
          )}
        </div>
      )}

      {/* Psychology */}
      {(trade.emotion || trade.followed_plan != null) && (
        <div className="card mb-6">
          <div className="grid-3">
            {trade.emotion && (
              <div>
                <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>สภาวะอารมณ์</div>
                <div>{EMOTION_LABELS[trade.emotion] ?? trade.emotion}</div>
              </div>
            )}
            {trade.confidence != null && (
              <div>
                <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>ความมั่นใจ</div>
                <div>{trade.confidence}/10</div>
              </div>
            )}
            {trade.followed_plan != null && (
              <div>
                <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>ทำตามแผน</div>
                <div className={trade.followed_plan ? 'text-positive' : 'text-negative'}>
                  {trade.followed_plan ? 'ทำตามแผน' : 'ไม่ทำตามแผน'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Review */}
      {trade.review && (
        <div className="card mb-6">
          <div className="text-muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)' }}>สิ่งที่ได้เรียนรู้ / บันทึกทบทวน</div>
          <div style={{ fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap' }}>{trade.review}</div>
        </div>
      )}

      {/* Screenshots */}
      {(beforeUrl || afterUrl) && (
        <div className="card mb-6">
          <div className="grid-2">
            {beforeUrl && (
              <div>
                <div className="text-muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-2)' }}>ภาพกราฟก่อนเข้าสถานะ (Before)</div>
                <img src={beforeUrl} alt="Before trade" style={{ width: '100%', borderRadius: 'var(--radius-md)' }} />
              </div>
            )}
            {afterUrl && (
              <div>
                <div className="text-muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-2)' }}>ภาพกราฟหลังปิดสถานะ (After)</div>
                <img src={afterUrl} alt="After trade" style={{ width: '100%', borderRadius: 'var(--radius-md)' }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => !deleting && setShowDeleteConfirm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title text-negative">ยืนยันการลบรายการเทรด</h2>
            <div style={{ marginBottom: 'var(--space-4)', lineHeight: '1.6', fontSize: 'var(--text-base)' }}>
              คุณแน่ใจหรือไม่ว่าต้องการลบรายการเทรด <strong>{trade.asset}</strong> ({trade.direction.toUpperCase()})?
              <div style={{ marginTop: '8px', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                ⚠️ การลบนี้จะนำผลกำไร/ขาดทุนออกจากเงินทุนและสถิติต่างๆ และไม่สามารถย้อนกลับได้
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={deleting}
                onClick={() => setShowDeleteConfirm(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? 'กำลังลบ…' : 'ยืนยันการลบ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

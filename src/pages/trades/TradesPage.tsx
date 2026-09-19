import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, withSyncMeta } from '../../db';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { syncToCloud } from '../../services/sync';
import { calculatePnL, calculateRMultiple, formatCurrency, formatR } from '../../utils/trading';
import { STATUS_LABELS, RESULT_LABELS, EMOTION_LABELS } from '../../locales/translations';
import { format } from 'date-fns';
import type { LocalTrade, Strategy, TradeResult } from '../../types';

export default function TradesPage() {
  const { user, profile } = useAuth();
  const { workspace, members } = useWorkspace();
  const navigate = useNavigate();
  const currency = profile?.preferred_currency ?? 'THB';

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [userFilter, setUserFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');

  // Confirmation dialog state
  const [confirmTrade, setConfirmTrade] = useState<LocalTrade | null>(null);
  const [targetResult, setTargetResult] = useState<TradeResult | null>(null);
  const [savingResult, setSavingResult] = useState(false);

  const allTrades = useLiveQuery<LocalTrade[]>(
    () => workspace
      ? db.trades.where('workspace_id').equals(workspace.id).filter(t => !t._deleted_at).toArray()
      : [],
    [workspace?.id]
  );

  const allStrategies = useLiveQuery<Strategy[]>(
    () => workspace
      ? db.strategies.where('workspace_id').equals(workspace.id).filter(s => !s._deleted_at).toArray()
      : [],
    [workspace?.id]
  );

  const strategyMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of allStrategies ?? []) {
      map.set(s.id, s.name);
    }
    return map;
  }, [allStrategies]);

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      map.set(m.user_id, m.profile?.display_name || 'คู่เทรด');
    }
    return map;
  }, [members]);

  const filteredTrades = useMemo(() => {
    let result = [...(allTrades ?? [])];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(t =>
        t.asset.toLowerCase().includes(q) ||
        (t.market ?? '').toLowerCase().includes(q)
      );
    }

    if (dateFrom) result = result.filter(t => t.trade_date >= dateFrom);
    if (dateTo) result = result.filter(t => t.trade_date <= dateTo);

    if (userFilter === 'mine') result = result.filter(t => t.user_id === user?.id);
    else if (userFilter === 'partner') result = result.filter(t => t.user_id !== user?.id);

    if (resultFilter === 'win') result = result.filter(t => t.result === 'tp' || (!t.result && (() => { const p = calculatePnL(t); return p !== null && p > 0; })()));
    else if (resultFilter === 'loss') result = result.filter(t => t.result === 'sl' || (!t.result && (() => { const p = calculatePnL(t); return p !== null && p <= 0; })()));
    else if (resultFilter === 'be') result = result.filter(t => t.result === 'be');

    result.sort((a, b) => b.trade_date.localeCompare(a.trade_date));
    return result;
  }, [allTrades, search, dateFrom, dateTo, userFilter, resultFilter, user?.id]);

  // Handle requesting result change (triggers confirmation popup)
  const handleRequestResult = (e: React.MouseEvent, trade: LocalTrade, res: TradeResult) => {
    e.stopPropagation();
    setConfirmTrade(trade);
    setTargetResult(res);
  };

  // Confirm saving result
  const handleConfirmSaveResult = async () => {
    if (!confirmTrade || !targetResult) return;
    setSavingResult(true);

    try {
      let exitPrice = confirmTrade.exit_price;
      if (exitPrice == null && confirmTrade.entry_price != null) {
        if (targetResult === 'tp' && confirmTrade.take_profit != null) {
          exitPrice = confirmTrade.take_profit;
        } else if (targetResult === 'sl' && confirmTrade.stop_loss != null) {
          exitPrice = confirmTrade.stop_loss;
        } else if (targetResult === 'be') {
          exitPrice = confirmTrade.entry_price;
        }
      }

      const updatedTrade = {
        ...confirmTrade,
        result: targetResult,
        status: targetResult !== 'none' ? ('closed' as const) : confirmTrade.status,
        exit_price: exitPrice,
        updated_at: new Date().toISOString(),
      };

      await db.trades.put(withSyncMeta(updatedTrade, 'pending'));
      syncToCloud().catch(() => {});
    } catch (err) {
      console.error('Error saving trade result:', err);
    } finally {
      setSavingResult(false);
      setConfirmTrade(null);
      setTargetResult(null);
    }
  };

  if (!allTrades) return <div className="loading-page"><div className="loading-spinner" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="page-title">รายการเทรด</h1>
          <p className="page-subtitle">ทั้งหมด {allTrades.length} รายการ</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/trades/new')}>
          ＋ เพิ่มรายการเทรด
        </button>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <input
          type="text"
          placeholder="ค้นหาสินทรัพย์ (เช่น BTC, ทองคำ)…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="ตั้งแต่วันที่" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="ถึงวันที่" />
        <select value={userFilter} onChange={e => setUserFilter(e.target.value)}>
          <option value="all">ผู้เทรดทั้งหมด</option>
          <option value="mine">รายการของฉัน</option>
          <option value="partner">รายการของคู่เทรด</option>
        </select>
        <select value={resultFilter} onChange={e => setResultFilter(e.target.value)}>
          <option value="all">ผลลัพธ์ทั้งหมด</option>
          <option value="win">กำไร (Win / TP)</option>
          <option value="loss">ขาดทุน (Loss / SL)</option>
          <option value="be">เสมอตัว (BE)</option>
        </select>
      </div>

      {filteredTrades.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-title">ไม่พบรายการเทรด</div>
          <div className="empty-state-text">
            เริ่มต้นบันทึกการเดินทางของคุณด้วยการเพิ่มรายการเทรด
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/trades/new')}>
            ＋ เพิ่มรายการเทรด
          </button>
        </div>
      ) : (
        <div className="card card-compact" style={{ padding: 0 }}>
          {filteredTrades.map(trade => {
            const pnl = calculatePnL(trade);
            const r = calculateRMultiple(trade);
            const stratName = trade.strategy_id ? strategyMap.get(trade.strategy_id) : null;
            const traderName = trade.user_id === user?.id ? 'คุณ' : (memberNameMap.get(trade.user_id) || 'คู่เทรด');

            return (
              <div
                key={trade.id}
                className="trade-card"
                onClick={() => navigate(`/trades/${trade.id}/edit`)}
              >
                {/* Header row: Asset, Badges, Trader, PnL & R */}
                <div className="trade-card-header">
                  <div className="trade-card-badges">
                    <span className="trade-row-asset" style={{ fontSize: 'var(--text-base)' }}>{trade.asset}</span>
                    <span className={`badge ${trade.direction === 'long' ? 'badge-long' : 'badge-short'}`}>
                      {trade.direction.toUpperCase()}
                    </span>
                    <span className={`badge ${trade.status === 'closed' ? 'badge-neutral' : trade.status === 'waiting' ? 'badge-neutral' : 'badge-sync'}`}>
                      {STATUS_LABELS[trade.status]}
                    </span>
                    {trade.result && trade.result !== 'none' && (
                      <span className={`badge ${trade.result === 'tp' ? 'badge-positive' : trade.result === 'sl' ? 'badge-negative' : 'badge-neutral'}`}>
                        {RESULT_LABELS[trade.result]}
                      </span>
                    )}
                    <span className="trade-row-date">
                      {format(new Date(trade.trade_date), 'MMM d, yyyy')}
                    </span>
                    <span className="badge badge-neutral" style={{ fontSize: '11px' }}>
                      👤 {traderName}
                    </span>
                    {trade._sync_status === 'pending' && (
                      <span className="badge badge-sync">รอซิงค์</span>
                    )}
                  </div>

                  <div className="trade-card-stats">
                    <div className="trade-result-btn-group" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        className={`trade-result-btn ${trade.result === 'tp' ? 'active-tp' : ''}`}
                        onClick={e => handleRequestResult(e, trade, 'tp')}
                        title="บันทึกผลเป็น TP"
                      >
                        TP
                      </button>
                      <button
                        type="button"
                        className={`trade-result-btn ${trade.result === 'sl' ? 'active-sl' : ''}`}
                        onClick={e => handleRequestResult(e, trade, 'sl')}
                        title="บันทึกผลเป็น SL"
                      >
                        SL
                      </button>
                      <button
                        type="button"
                        className={`trade-result-btn ${trade.result === 'be' ? 'active-be' : ''}`}
                        onClick={e => handleRequestResult(e, trade, 'be')}
                        title="บันทึกผลเป็น BE"
                      >
                        BE
                      </button>
                      <button
                        type="button"
                        className="trade-result-btn"
                        onClick={e => {
                          e.stopPropagation();
                          navigate(`/trades/${trade.id}/edit`);
                        }}
                        title="แก้ไขรายการนี้โดยตรง"
                      >
                        ✏️ แก้ไข
                      </button>
                    </div>

                    <span style={{ fontWeight: 600, minWidth: '42px', textAlign: 'right' }}>
                      {formatR(r)}
                    </span>
                    <span className={`pnl-value ${(pnl ?? 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}`} style={{ fontWeight: 700, minWidth: '70px', textAlign: 'right' }}>
                      {pnl != null ? formatCurrency(pnl, currency) : '—'}
                    </span>
                  </div>
                </div>

                {/* Key Details Grid */}
                <div className="trade-card-details">
                  <div className="trade-card-meta-item">
                    <span className="trade-card-meta-label">ราคาเข้า (Entry)</span>
                    <span className="trade-card-meta-val">{trade.entry_price ?? '—'}</span>
                  </div>
                  <div className="trade-card-meta-item">
                    <span className="trade-card-meta-label">ราคาออก (Exit)</span>
                    <span className="trade-card-meta-val">{trade.exit_price ?? '—'}</span>
                  </div>
                  <div className="trade-card-meta-item">
                    <span className="trade-card-meta-label">Stop Loss</span>
                    <span className="trade-card-meta-val text-negative">{trade.stop_loss ?? '—'}</span>
                  </div>
                  <div className="trade-card-meta-item">
                    <span className="trade-card-meta-label">Take Profit</span>
                    <span className="trade-card-meta-val text-positive">{trade.take_profit ?? '—'}</span>
                  </div>
                  <div className="trade-card-meta-item">
                    <span className="trade-card-meta-label">ขนาดไม้ (Size)</span>
                    <span className="trade-card-meta-val">
                      {trade.position_size ?? '—'} {trade.leverage ? `(${trade.leverage}x)` : ''}
                    </span>
                  </div>
                  {stratName && (
                    <div className="trade-card-meta-item">
                      <span className="trade-card-meta-label">กลยุทธ์</span>
                      <span className="trade-card-meta-val" title={stratName}>🎯 {stratName}</span>
                    </div>
                  )}
                  {trade.emotion && (
                    <div className="trade-card-meta-item">
                      <span className="trade-card-meta-label">อารมณ์</span>
                      <span className="trade-card-meta-val">💭 {EMOTION_LABELS[trade.emotion] ?? trade.emotion}</span>
                    </div>
                  )}
                </div>

                {/* Short Entry/Exit reason or review if present */}
                {(trade.entry_reason || trade.exit_reason || trade.review) && (
                  <div className="trade-card-notes">
                    {trade.entry_reason ? `เหตุผลเข้า: ${trade.entry_reason}` : ''}
                    {trade.entry_reason && trade.review ? ' · ' : ''}
                    {trade.review ? `ทบทวน: ${trade.review}` : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* TP / SL / BE Confirmation Dialog */}
      {confirmTrade && targetResult && (
        <div className="modal-overlay" onClick={() => !savingResult && setConfirmTrade(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">ยืนยันผลการเทรด</h2>
            <div style={{ marginBottom: 'var(--space-6)', lineHeight: '1.6', fontSize: 'var(--text-base)' }}>
              ต้องการบันทึกผลการเทรด <strong>{confirmTrade.asset}</strong> ({confirmTrade.direction.toUpperCase()}) เป็น{' '}
              <span className={`badge ${targetResult === 'tp' ? 'badge-positive' : targetResult === 'sl' ? 'badge-negative' : 'badge-neutral'}`} style={{ fontSize: 'var(--text-sm)' }}>
                {RESULT_LABELS[targetResult]}
              </span>{' '}
              ใช่หรือไม่?
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={savingResult}
                onClick={() => {
                  setConfirmTrade(null);
                  setTargetResult(null);
                }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingResult}
                onClick={handleConfirmSaveResult}
              >
                {savingResult ? 'กำลังบันทึก…' : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

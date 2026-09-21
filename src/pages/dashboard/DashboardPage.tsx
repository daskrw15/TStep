import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useExchangeRate } from '../../hooks/useExchangeRate';
import { calculatePnL, calculateRMultiple, calculateStatistics, calculateEquityCurve, calculateCapitalSummary, formatCurrency, formatR, convertUsdToThb } from '../../utils/trading';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import type { LocalTrade } from '../../types';

export default function DashboardPage() {
  const { user } = useAuth();
  const { workspace, members, partner } = useWorkspace();
  const navigate = useNavigate();
  const { usdToThb } = useExchangeRate();

  const trades = useLiveQuery<LocalTrade[]>(
    () => workspace
      ? db.trades.where('workspace_id').equals(workspace.id).filter(t => !t._deleted_at).toArray()
      : [],
    [workspace?.id]
  );

  const now = new Date();
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd');

  const monthlyTrades = useMemo(() =>
    (trades ?? []).filter(t => t.trade_date >= monthStart && t.trade_date <= monthEnd),
    [trades, monthStart, monthEnd]
  );

  const myMonthly = useMemo(() =>
    monthlyTrades.filter(t => t.user_id === user?.id),
    [monthlyTrades, user?.id]
  );

  const partnerMonthly = useMemo(() =>
    monthlyTrades.filter(t => t.user_id !== user?.id),
    [monthlyTrades, user?.id]
  );

  const myMonthlyStats = useMemo(() => calculateStatistics(myMonthly), [myMonthly]);
  const partnerMonthlyStats = useMemo(() => calculateStatistics(partnerMonthly), [partnerMonthly]);
  const combinedMonthlyStats = useMemo(() => calculateStatistics(monthlyTrades), [monthlyTrades]);

  // Overall workspace performance stats
  const overallStats = useMemo(() => calculateStatistics(trades ?? []), [trades]);

  const partnerName = partner?.profile?.display_name || 'คู่เทรด';

  // Capital calculations via centralized source of truth (ALL IN USD)
  const myMem = members.find(m => m.user_id === user?.id);
  const pMem = members.find(m => m.user_id !== user?.id);

  const initialUserCap = workspace?.user_capital != null
    ? Number(workspace.user_capital)
    : Number(myMem?.capital ?? 0);

  const initialPartnerCap = workspace?.partner_capital != null
    ? Number(workspace.partner_capital)
    : Number(pMem?.capital ?? 0);

  const capitalSummary = useMemo(() => {
    return calculateCapitalSummary({
      initialUserCapital: initialUserCap,
      initialPartnerCapital: initialPartnerCap,
      trades: trades ?? [],
      userId: user?.id,
      usdToThbRate: usdToThb,
    });
  }, [initialUserCap, initialPartnerCap, trades, user?.id, usdToThb]);

  const equityCurve = useMemo(() => {
    return calculateEquityCurve(trades ?? [], capitalSummary.initialTotalCapital);
  }, [trades, capitalSummary.initialTotalCapital]);

  const recentTrades = useMemo(() =>
    [...(trades ?? [])]
      .sort((a, b) => b.trade_date.localeCompare(a.trade_date))
      .slice(0, 5),
    [trades]
  );

  if (!trades) return <div className="loading-page"><div className="loading-spinner" /></div>;

  const formatThbDisplay = (usd: number) => {
    const thb = convertUsdToThb(usd, usdToThb);
    return `฿${thb.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const largerOwner = capitalSummary.currentTotalCapital > 0
    ? (capitalSummary.currentUserCapital > capitalSummary.currentPartnerCapital
        ? 'คุณ'
        : capitalSummary.currentPartnerCapital > capitalSummary.currentUserCapital
        ? partnerName
        : 'เท่ากันทั้งสองคน')
    : '—';

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h1 className="page-title">ภาพรวม</h1>
          <p className="page-subtitle">{format(now, 'MMMM yyyy')}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/trades/new')}>
          ＋ เพิ่มรายการเทรด
        </button>
      </div>

      {/* Monthly Summary Cards - Always visible (USD canonical) */}
      <div className="grid-3 mb-6">
        <div className="card">
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
            คุณ (เดือนนี้)
          </div>
          <div className={`pnl-value ${myMonthlyStats.totalPnL >= 0 ? 'pnl-positive' : 'pnl-negative'}`} style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-1)' }}>
            {formatCurrency(myMonthlyStats.totalPnL, 'USD')}
          </div>
          <div className="text-muted" style={{ fontSize: '11px', marginBottom: 'var(--space-2)' }}>
            ≈ {formatThbDisplay(myMonthlyStats.totalPnL)}
          </div>
          <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
            {myMonthlyStats.totalTrades} รายการ · Win Rate {(myMonthlyStats.winRate * 100).toFixed(0)}%
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
            {partnerName} (เดือนนี้)
          </div>
          <div className={`pnl-value ${partnerMonthlyStats.totalPnL >= 0 ? 'pnl-positive' : 'pnl-negative'}`} style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-1)' }}>
            {formatCurrency(partnerMonthlyStats.totalPnL, 'USD')}
          </div>
          <div className="text-muted" style={{ fontSize: '11px', marginBottom: 'var(--space-2)' }}>
            ≈ {formatThbDisplay(partnerMonthlyStats.totalPnL)}
          </div>
          <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
            {partnerMonthlyStats.totalTrades} รายการ · Win Rate {(partnerMonthlyStats.winRate * 100).toFixed(0)}%
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
            รวมทั้งคู่ (เดือนนี้)
          </div>
          <div className={`pnl-value ${combinedMonthlyStats.totalPnL >= 0 ? 'pnl-positive' : 'pnl-negative'}`} style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-1)' }}>
            {formatCurrency(combinedMonthlyStats.totalPnL, 'USD')}
          </div>
          <div className="text-muted" style={{ fontSize: '11px', marginBottom: 'var(--space-2)' }}>
            ≈ {formatThbDisplay(combinedMonthlyStats.totalPnL)}
          </div>
          <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
            รวมทั้งหมด {combinedMonthlyStats.totalTrades} รายการ
          </div>
        </div>
      </div>

      {/* Capital & Ownership Section - Always visible */}
      <div className="card mb-6">
        <div className="flex justify-between items-center mb-2">
          <div>
            <div style={{ fontSize: 'var(--text-base)', fontWeight: 600 }}>💰 เงินทุนและสัดส่วนการถือครอง (Capital & Ownership)</div>
            <div className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: '2px' }}>
              คำนวณในสกุล USD เป็นหลัก: เงินทุนเริ่มต้น + Realized P&L สะสม
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/settings')}
          >
            ⚙️ ตั้งค่าเงินทุนเริ่มต้น (THB)
          </button>
        </div>

        <div>
          {/* Total summary row */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Total Capital (USD) / เงินทุนปัจจุบัน</div>
              <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                ${capitalSummary.currentTotalCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', alignSelf: 'flex-end', marginBottom: '4px' }}>
              ≈ ฿{(capitalSummary.currentTotalCapitalThb ?? convertUsdToThb(capitalSummary.currentTotalCapital, usdToThb)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} THB
            </span>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                เริ่มต้น ${capitalSummary.initialTotalCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (≈ ฿{(capitalSummary.initialTotalCapitalThb ?? convertUsdToThb(capitalSummary.initialTotalCapital, usdToThb)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) · Realized P&L
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                <span className={`pnl-value ${capitalSummary.totalRealizedPnL >= 0 ? 'pnl-positive' : 'pnl-negative'}`} style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>
                  {formatCurrency(capitalSummary.totalRealizedPnL, 'USD')}
                </span>
                {largerOwner !== '—' && (
                  <span className="badge badge-neutral" style={{ fontSize: '11px' }}>
                    👑 ส่วนใหญ่: {largerOwner}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Percentage bar (Current Capital Share) */}
          <div className="capital-bar-container">
            <div
              className="capital-bar-my"
              style={{ width: `${capitalSummary.currentTotalCapital > 0 ? capitalSummary.currentUserCapitalShare : 50}%` }}
              title={`คุณ: ${capitalSummary.currentUserCapitalShare.toFixed(1)}%`}
            />
            <div
              className="capital-bar-partner"
              style={{ width: `${capitalSummary.currentTotalCapital > 0 ? capitalSummary.currentPartnerCapitalShare : 50}%` }}
              title={`${partnerName}: ${capitalSummary.currentPartnerCapitalShare.toFixed(1)}%`}
            />
          </div>

          {/* Member breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div className="capital-member-row" style={{ background: 'rgba(255,255,255,0.02)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
              <div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-accent)' }} />
                  คุณ
                </div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginTop: '2px' }}>
                  ${capitalSummary.currentUserCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                  ≈ ฿{(capitalSummary.currentUserCapitalThb ?? convertUsdToThb(capitalSummary.currentUserCapital, usdToThb)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} THB
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  เริ่มต้น ${capitalSummary.initialUserCapital.toFixed(2)} ({capitalSummary.initialUserOwnershipPct.toFixed(1)}%)
                  {capitalSummary.userRealizedPnL !== 0 && (
                    <span className={capitalSummary.userRealizedPnL >= 0 ? ' pnl-positive' : ' pnl-negative'}>
                      {' '}({formatCurrency(capitalSummary.userRealizedPnL, 'USD')})
                    </span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-accent)' }}>
                  {capitalSummary.currentTotalCapital > 0 ? `${capitalSummary.currentUserCapitalShare.toFixed(1)}%` : '0%'}
                </div>
                <div className="text-muted" style={{ fontSize: '11px' }}>สัดส่วนปัจจุบัน</div>
              </div>
            </div>

            <div className="capital-member-row" style={{ background: 'rgba(255,255,255,0.02)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
              <div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#a855f7' }} />
                  {partnerName}
                </div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginTop: '2px' }}>
                  ${capitalSummary.currentPartnerCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                  ≈ ฿{(capitalSummary.currentPartnerCapitalThb ?? convertUsdToThb(capitalSummary.currentPartnerCapital, usdToThb)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} THB
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  เริ่มต้น ${capitalSummary.initialPartnerCapital.toFixed(2)} ({capitalSummary.initialPartnerOwnershipPct.toFixed(1)}%)
                  {capitalSummary.partnerRealizedPnL !== 0 && (
                    <span className={capitalSummary.partnerRealizedPnL >= 0 ? ' pnl-positive' : ' pnl-negative'}>
                      {' '}({formatCurrency(capitalSummary.partnerRealizedPnL, 'USD')})
                    </span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: '#a855f7' }}>
                  {capitalSummary.currentTotalCapital > 0 ? `${capitalSummary.currentPartnerCapitalShare.toFixed(1)}%` : '0%'}
                </div>
                <div className="text-muted" style={{ fontSize: '11px' }}>สัดส่วนปัจจุบัน</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trading Performance & History */}
      {trades.length === 0 ? (
        <div className="card mb-6" style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)' }}>
          <div style={{ fontSize: '32px', marginBottom: 'var(--space-2)' }}>📊</div>
          <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
            ยังไม่มีข้อมูลรายการเทรด
          </div>
          <div className="text-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
            สถิติการเทรดและ Equity Curve จะปรากฏที่นี่เมื่อคุณเริ่มบันทึกรายการแรก
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/trades/new')}>
            ＋ บันทึกรายการเทรดแรก
          </button>
        </div>
      ) : (
        <>
          {/* Key Trading Statistics Summary */}
          <div className="card mb-6">
            <div className="flex justify-between items-center mb-4">
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>📊 สถิติการเทรดภาพรวม (Overall Performance)</div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/statistics')}>ดูสถิติละเอียด →</button>
            </div>
            <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--space-3)' }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>Win Rate</div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginTop: '2px' }}>
                  {(overallStats.winRate * 100).toFixed(1)}%
                </div>
                <div className="text-muted" style={{ fontSize: '10px' }}>
                  ชนะ {overallStats.winCount} / แพ้ {overallStats.lossCount} {overallStats.breakEvenCount > 0 ? `/ BE ${overallStats.breakEvenCount}` : ''}
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>Profit Factor</div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginTop: '2px' }}>
                  {overallStats.profitFactor === Infinity ? '∞' : overallStats.profitFactor.toFixed(2)}
                </div>
                <div className="text-muted" style={{ fontSize: '10px' }}>
                  Avg Win {formatCurrency(overallStats.averageWin, 'USD')}
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>Avg R-Multiple</div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginTop: '2px' }}>
                  {overallStats.averageR != null ? overallStats.averageR.toFixed(2) + 'R' : '—'}
                </div>
                <div className="text-muted" style={{ fontSize: '10px' }}>
                  Expectancy {formatCurrency(overallStats.expectancy, 'USD')}
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>Max Drawdown</div>
                <div className="pnl-negative" style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginTop: '2px' }}>
                  {formatCurrency(-overallStats.maxDrawdown, 'USD')}
                </div>
                <div className="text-muted" style={{ fontSize: '10px' }}>
                  ทั้งหมด {overallStats.totalTrades} ไม้
                </div>
              </div>
            </div>
          </div>

          {/* Equity Curve */}
          {equityCurve.length > 0 && (
            <div className="card mb-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>📈 กราฟการเติบโตของพอร์ต (Equity Curve - USD)</div>
                  <div className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: '2px' }}>
                    เริ่มต้น ${capitalSummary.initialTotalCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} → ปัจจุบัน ${capitalSummary.currentTotalCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    {usdToThb > 0 && ` (≈ ฿${(capitalSummary.currentTotalCapitalThb ?? convertUsdToThb(capitalSummary.currentTotalCapital, usdToThb)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} THB)`}
                  </div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={equityCurve}>
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7185' }} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6b7185' }}
                    domain={['auto', 'auto']}
                    tickFormatter={(val) => `$${Number(val).toLocaleString()}`}
                  />
                  <Tooltip
                    contentStyle={{ background: '#1e2130', border: '1px solid #2e3145', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#9ba1b0' }}
                    formatter={(val) => [`$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`, 'มูลค่าพอร์ต (Equity)']}
                  />
                  <Line
                    type="monotone"
                    dataKey="equity"
                    stroke="#6c8cff"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#6c8cff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Recent Trades */}
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>รายการเทรดล่าสุด</div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/trades')}>ดูทั้งหมด</button>
            </div>
            {recentTrades.map(trade => {
              const pnl = calculatePnL(trade);
              const r = calculateRMultiple(trade);
              return (
                <div key={trade.id} className="trade-row" onClick={() => navigate(`/trades/${trade.id}/edit`)}>
                  <span className="trade-row-date">{format(new Date(trade.trade_date), 'MMM d')}</span>
                  <span className="trade-row-asset">{trade.asset}</span>
                  <span className={`badge ${trade.direction === 'long' ? 'badge-long' : 'badge-short'}`}>
                    {trade.direction.toUpperCase()}
                  </span>
                  <span className={`badge ${trade.status === 'closed' ? 'badge-neutral' : trade.status === 'waiting' ? 'badge-neutral' : 'badge-sync'}`}>
                    {trade.status === 'waiting' ? 'กำลังรอ' : trade.status === 'open' ? 'เปิดอยู่' : 'ปิดแล้ว'}
                  </span>
                  {trade.result && trade.result !== 'none' && (
                    <span className={`badge ${trade.result === 'tp' ? 'badge-positive' : trade.result === 'sl' ? 'badge-negative' : 'badge-neutral'}`}>
                      {trade.result.toUpperCase()}
                    </span>
                  )}
                  <span style={{ fontSize: 'var(--text-sm)' }}>{formatR(r)}</span>
                  <span className={`pnl-value ${(pnl ?? 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}`} style={{ fontSize: 'var(--text-sm)', textAlign: 'right' }}>
                    {pnl != null ? formatCurrency(pnl, 'USD') : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

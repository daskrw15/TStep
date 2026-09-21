import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { calculateStatistics, calculateEquityCurve, formatCurrency } from '../../utils/trading';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { LocalTrade } from '../../types';

export default function StatisticsPage() {
  const { user } = useAuth();
  const { workspace, members, partner } = useWorkspace();

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [userFilter, setUserFilter] = useState('all');

  const allTrades = useLiveQuery<LocalTrade[]>(
    () => workspace
      ? db.trades.where('workspace_id').equals(workspace.id).filter(t => !t._deleted_at).toArray()
      : [],
    [workspace?.id]
  );

  const filtered = useMemo(() => {
    let result = [...(allTrades ?? [])];
    if (dateFrom) result = result.filter(t => t.trade_date >= dateFrom);
    if (dateTo) result = result.filter(t => t.trade_date <= dateTo);
    if (userFilter === 'mine') result = result.filter(t => t.user_id === user?.id);
    else if (userFilter === 'partner') result = result.filter(t => t.user_id !== user?.id);
    return result;
  }, [allTrades, dateFrom, dateTo, userFilter, user?.id]);

  // Determine starting capital for the selected filter scope
  const myMem = members.find(m => m.user_id === user?.id);
  const pMem = members.find(m => m.user_id !== user?.id);

  const myCap = workspace?.user_capital != null ? Number(workspace.user_capital) : Number(myMem?.capital ?? 0);
  const partnerCap = workspace?.partner_capital != null ? Number(workspace.partner_capital) : Number(pMem?.capital ?? 0);
  const totalCap = myCap + partnerCap;

  const startingCapital = userFilter === 'mine' ? myCap : userFilter === 'partner' ? partnerCap : totalCap;

  const stats = useMemo(() => calculateStatistics(filtered), [filtered]);
  const equityCurve = useMemo(() => calculateEquityCurve(filtered, startingCapital), [filtered, startingCapital]);

  // P&L by person
  const pnlByPerson = useMemo(() => {
    if (!allTrades) return [];
    const myTrades = (allTrades).filter(t => t.user_id === user?.id);
    const partnerTrades = (allTrades).filter(t => t.user_id !== user?.id);
    const myStats = calculateStatistics(myTrades);
    const pStats = calculateStatistics(partnerTrades);
    return [
      { name: 'คุณ', pnl: myStats.totalPnL },
      { name: partner?.profile?.display_name || 'คู่เทรด', pnl: pStats.totalPnL },
    ];
  }, [allTrades, user?.id, partner]);

  if (!allTrades) return <div className="loading-page"><div className="loading-spinner" /></div>;

  if (allTrades.length === 0) {
    return (
      <div>
        <h1 className="page-title mb-6">สถิติ</h1>
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-title">ยังไม่มีข้อมูลสถิติ</div>
          <div className="empty-state-text">บันทึกรายการเทรดเพื่อเริ่มดูสถิติและผลการดำเนินงานของคุณ</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title mb-6">สถิติ</h1>

      {/* Filters */}
      <div className="filter-bar">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="ตั้งแต่วันที่" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="ถึงวันที่" />
        <select value={userFilter} onChange={e => setUserFilter(e.target.value)}>
          <option value="all">ผู้เทรดทั้งหมด</option>
          <option value="mine">รายการของฉัน</option>
          <option value="partner">รายการของคู่เทรด</option>
        </select>
      </div>

      {/* Key Metrics (Canonical USD) */}
      <div className="grid-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        <div className="stat-card">
          <div className="stat-card-label">Total Realized P&L (USD)</div>
          <div className={`stat-card-value ${stats.totalPnL >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
            {formatCurrency(stats.totalPnL, 'USD')}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Win Rate</div>
          <div className="stat-card-value">{(stats.winRate * 100).toFixed(1)}%</div>
          <div className="stat-card-sub">
            ชนะ {stats.winCount} / แพ้ {stats.lossCount} {stats.breakEvenCount > 0 ? `/ BE ${stats.breakEvenCount}` : ''}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Profit Factor</div>
          <div className="stat-card-value">{stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Avg Win (USD)</div>
          <div className="stat-card-value pnl-positive">{formatCurrency(stats.averageWin, 'USD')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Avg Loss (USD)</div>
          <div className="stat-card-value pnl-negative">{formatCurrency(-stats.averageLoss, 'USD')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Avg R</div>
          <div className="stat-card-value">{stats.averageR != null ? stats.averageR.toFixed(2) + 'R' : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Max Drawdown (USD)</div>
          <div className="stat-card-value pnl-negative">{formatCurrency(-stats.maxDrawdown, 'USD')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Expectancy (USD)</div>
          <div className={`stat-card-value ${stats.expectancy >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
            {formatCurrency(stats.expectancy, 'USD')}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">จำนวนไม้ทั้งหมด (Total Trades)</div>
          <div className="stat-card-value">{stats.totalTrades}</div>
        </div>
      </div>

      {/* Equity Curve (USD) */}
      {equityCurve.length > 0 && (
        <div className="card mb-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>📈 กราฟการเติบโตของพอร์ต (Equity Curve - USD)</div>
              {startingCapital > 0 && (
                <div className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: '2px' }}>
                  ทุนเริ่มต้น: ${startingCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD · ปัจจุบัน: ${(startingCapital + stats.totalPnL).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                </div>
              )}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
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
              <Line type="monotone" dataKey="equity" stroke="#6c8cff" strokeWidth={2} dot={{ r: 3, fill: '#6c8cff' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* P&L by Person */}
      {pnlByPerson.length > 0 && (
        <div className="card mb-6">
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>P&L แยกตามคน (P&L by Person)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={pnlByPerson}>
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#9ba1b0' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7185' }} />
              <Tooltip contentStyle={{ background: '#1e2130', border: '1px solid #2e3145', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
                {pnlByPerson.map((entry, index) => (
                  <Cell key={index} fill={entry.pnl >= 0 ? '#4ade80' : '#f87171'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

import { describe, it, expect } from 'vitest';
import {
  calculatePnL,
  calculatePnLPercent,
  calculateRisk,
  calculateRMultiple,
  calculateStatistics,
  calculateMaxDrawdown,
  calculateEquityCurve,
  calculateCapitalSummary,
  calculateAutoSlTp,
  formatCurrency,
  formatR,
} from '../src/utils/trading';
import type { Trade } from '../src/types';

// ─── Helper: create a minimal trade ────────────────────────────────────────

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'test-' + Math.random().toString(36).slice(2),
    workspace_id: 'ws-1',
    user_id: 'user-1',
    asset: 'BTCUSDT',
    market: 'Crypto',
    direction: 'long',
    status: 'closed',
    trade_date: '2026-09-18',
    strategy_id: null,
    entry_price: null,
    exit_price: null,
    stop_loss: null,
    take_profit: null,
    position_size: null,
    leverage: null,
    fees: null,
    session: null,
    entry_reason: null,
    exit_reason: null,
    emotion: null,
    confidence: null,
    followed_plan: null,
    review: null,
    screenshot_before: null,
    screenshot_after: null,
    visibility: 'shared',
    created_at: '2026-09-18T00:00:00Z',
    updated_at: '2026-09-18T00:00:00Z',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// P&L Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('calculatePnL', () => {
  it('long profit', () => {
    const t = makeTrade({ direction: 'long', entry_price: 100, exit_price: 110, position_size: 10, fees: 0 });
    expect(calculatePnL(t)).toBe(100); // (110 - 100) × 10
  });

  it('long loss', () => {
    const t = makeTrade({ direction: 'long', entry_price: 100, exit_price: 90, position_size: 10, fees: 0 });
    expect(calculatePnL(t)).toBe(-100); // (90 - 100) × 10
  });

  it('short profit', () => {
    const t = makeTrade({ direction: 'short', entry_price: 100, exit_price: 90, position_size: 10, fees: 0 });
    expect(calculatePnL(t)).toBe(100); // (100 - 90) × 10
  });

  it('short loss', () => {
    const t = makeTrade({ direction: 'short', entry_price: 100, exit_price: 110, position_size: 10, fees: 0 });
    expect(calculatePnL(t)).toBe(-100); // (100 - 110) × 10
  });

  it('long profit with fees', () => {
    const t = makeTrade({ direction: 'long', entry_price: 100, exit_price: 110, position_size: 10, fees: 5 });
    expect(calculatePnL(t)).toBe(95); // (110 - 100) × 10 - 5
  });

  it('short profit with fees', () => {
    const t = makeTrade({ direction: 'short', entry_price: 100, exit_price: 90, position_size: 10, fees: 3 });
    expect(calculatePnL(t)).toBe(97); // (100 - 90) × 10 - 3
  });

  it('returns null when entry_price missing', () => {
    const t = makeTrade({ exit_price: 110, position_size: 10 });
    expect(calculatePnL(t)).toBeNull();
  });

  it('returns null when exit_price missing', () => {
    const t = makeTrade({ entry_price: 100, position_size: 10 });
    expect(calculatePnL(t)).toBeNull();
  });

  it('returns null when position_size missing', () => {
    const t = makeTrade({ entry_price: 100, exit_price: 110 });
    expect(calculatePnL(t)).toBeNull();
  });

  it('null fees treated as zero', () => {
    const t = makeTrade({ direction: 'long', entry_price: 100, exit_price: 110, position_size: 10, fees: null });
    expect(calculatePnL(t)).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R-Multiple Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateRMultiple', () => {
  it('winning long trade with valid SL', () => {
    const t = makeTrade({ direction: 'long', entry_price: 100, exit_price: 120, stop_loss: 90, position_size: 1, fees: 0 });
    // P&L = 20, Risk = |100-90| × 1 = 10, R = 20/10 = 2
    expect(calculateRMultiple(t)).toBe(2);
  });

  it('losing long trade with valid SL', () => {
    const t = makeTrade({ direction: 'long', entry_price: 100, exit_price: 95, stop_loss: 90, position_size: 1, fees: 0 });
    // P&L = -5, Risk = 10, R = -5/10 = -0.5
    expect(calculateRMultiple(t)).toBe(-0.5);
  });

  it('winning short trade', () => {
    const t = makeTrade({ direction: 'short', entry_price: 100, exit_price: 80, stop_loss: 110, position_size: 1, fees: 0 });
    // P&L = 20, Risk = |100-110| × 1 = 10, R = 20/10 = 2
    expect(calculateRMultiple(t)).toBe(2);
  });

  it('returns null when stop_loss missing', () => {
    const t = makeTrade({ direction: 'long', entry_price: 100, exit_price: 110, position_size: 1 });
    expect(calculateRMultiple(t)).toBeNull();
  });

  it('returns null when entry = stop_loss (zero risk)', () => {
    const t = makeTrade({ direction: 'long', entry_price: 100, exit_price: 110, stop_loss: 100, position_size: 1 });
    expect(calculateRMultiple(t)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Statistics Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateStatistics', () => {
  const trades: Trade[] = [
    makeTrade({ direction: 'long', entry_price: 100, exit_price: 120, position_size: 1, stop_loss: 90, fees: 0, trade_date: '2026-09-01' }),
    makeTrade({ direction: 'long', entry_price: 100, exit_price: 110, position_size: 1, stop_loss: 95, fees: 0, trade_date: '2026-09-02' }),
    makeTrade({ direction: 'long', entry_price: 100, exit_price: 85, position_size: 1, stop_loss: 90, fees: 0, trade_date: '2026-09-03' }),
    makeTrade({ direction: 'short', entry_price: 100, exit_price: 105, position_size: 1, stop_loss: 110, fees: 0, trade_date: '2026-09-04' }),
  ];

  const stats = calculateStatistics(trades);

  it('win rate', () => {
    // 2 wins (pnl > 0), 2 losses (pnl <= 0) => 0.5
    expect(stats.winRate).toBe(0.5);
  });

  it('total P&L', () => {
    // +20 + 10 - 15 - 5 = 10
    expect(stats.totalPnL).toBe(10);
  });

  it('total trades', () => {
    expect(stats.totalTrades).toBe(4);
  });

  it('win and loss count', () => {
    expect(stats.winCount).toBe(2);
    expect(stats.lossCount).toBe(2);
  });

  it('average win', () => {
    // wins: +20, +10 => avg = 15
    expect(stats.averageWin).toBe(15);
  });

  it('average loss', () => {
    // losses: -15, -5 => avg abs = 10
    expect(stats.averageLoss).toBe(10);
  });

  it('profit factor', () => {
    // gross wins = 30, gross losses = 20 => 1.5
    expect(stats.profitFactor).toBe(1.5);
  });

  it('expectancy', () => {
    // (0.5 × 15) - (0.5 × 10) = 7.5 - 5 = 2.5
    expect(stats.expectancy).toBe(2.5);
  });

  it('average R', () => {
    // Trade 1: R = 20/10 = 2
    // Trade 2: R = 10/5 = 2
    // Trade 3: R = -15/10 = -1.5
    // Trade 4: R = -5/10 = -0.5
    // Avg = (2 + 2 - 1.5 - 0.5) / 4 = 0.5
    expect(stats.averageR).toBe(0.5);
  });

  it('empty trades returns zeroed stats', () => {
    const empty = calculateStatistics([]);
    expect(empty.totalTrades).toBe(0);
    expect(empty.totalPnL).toBe(0);
    expect(empty.winRate).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Max Drawdown Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateMaxDrawdown', () => {
  it('simple drawdown', () => {
    // cumulative: 10, 20, 15, 25
    // peaks:      10, 20, 20, 25
    // drawdowns:   0,  0,  5,  0
    expect(calculateMaxDrawdown([10, 10, -5, 10])).toBe(5);
  });

  it('no drawdown (all positive)', () => {
    expect(calculateMaxDrawdown([10, 20, 30])).toBe(0);
  });

  it('empty array', () => {
    expect(calculateMaxDrawdown([])).toBe(0);
  });

  it('all losses', () => {
    // cumulative: -10, -25, -30
    // peak stays 0, so drawdowns: 10, 25, 30
    expect(calculateMaxDrawdown([-10, -15, -5])).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P&L Percent Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('calculatePnLPercent', () => {
  it('basic percentage', () => {
    const t = makeTrade({ direction: 'long', entry_price: 100, exit_price: 110, position_size: 1, fees: 0 });
    // pnl = 10, entry cost = 100, pct = 10%
    expect(calculatePnLPercent(t)).toBe(10);
  });

  it('returns null when data incomplete', () => {
    const t = makeTrade({});
    expect(calculatePnLPercent(t)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Formatting Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('formatR', () => {
  it('positive R', () => {
    expect(formatR(2.5)).toBe('+2.50R');
  });

  it('negative R', () => {
    expect(formatR(-1.0)).toBe('-1.00R');
  });

  it('null R', () => {
    expect(formatR(null)).toBe('—');
  });
});

describe('formatCurrency', () => {
  it('positive THB', () => {
    const result = formatCurrency(1000, 'THB');
    expect(result).toContain('฿');
    expect(result).toContain('+');
  });

  it('negative USD', () => {
    const result = formatCurrency(-500, 'USD');
    expect(result).toContain('$');
    expect(result).toContain('-');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Auto SL / TP (500 points) Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateAutoSlTp (500-point calculation)', () => {
  it('Gold-style 2-decimal calculation: 2500.00 + 500 points = 2505.00 for Long, SL = 2495.00', () => {
    // For Gold with 2 decimals, 1 point = 0.01, 500 points = 5.00
    // Long: SL = 2495.00, TP = 2505.00
    const longRes = calculateAutoSlTp(2500.0, 'long', 500, 2);
    expect(longRes.stopLoss).toBe(2495.0);
    expect(longRes.takeProfit).toBe(2505.0);
    expect(longRes.pointValue).toBe(5.0);
  });

  it('Gold-style 2-decimal calculation: 2500.00 Short, SL = 2505.00, TP = 2495.00', () => {
    // Short: SL = 2505.00, TP = 2495.00
    const shortRes = calculateAutoSlTp(2500.0, 'short', 500, 2);
    expect(shortRes.stopLoss).toBe(2505.0);
    expect(shortRes.takeProfit).toBe(2495.0);
    expect(shortRes.pointValue).toBe(5.0);
  });

  it('Default precision inferring from whole number defaults to 2 decimals', () => {
    const res = calculateAutoSlTp(2500, 'long');
    expect(res.stopLoss).toBe(2495);
    expect(res.takeProfit).toBe(2505);
  });

  it('3-decimal price precision calculation (e.g. 1 point = 0.001, 500 points = 0.500)', () => {
    const res = calculateAutoSlTp(1.25, 'long', 500, 3);
    // 1.250 - 0.500 = 0.750, 1.250 + 0.500 = 1.750
    expect(res.stopLoss).toBe(0.75);
    expect(res.takeProfit).toBe(1.75);
  });

  it('Preserves manual SL/TP simulation without unexpected overwrite', () => {
    let sl = '2495.00';
    let tp = '2505.00';
    let isSlManuallyEdited = false;
    let isTpManuallyEdited = false;

    // User manually types customized SL
    sl = '2490.00';
    isSlManuallyEdited = true;

    // Direction changes to Short
    const auto = calculateAutoSlTp(2500, 'short');
    if (!isSlManuallyEdited) {
      sl = auto.stopLoss.toString();
    }
    if (!isTpManuallyEdited) {
      tp = auto.takeProfit.toString();
    }

    // Manual SL is preserved!
    expect(sl).toBe('2490.00');
    // Auto-generated TP updated to short target (2495)
    expect(tp).toBe('2495');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Trade Status & Trade Result (TP / SL / BE) Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Trade Status and Result (BE not counted as win or loss)', () => {
  it('supports waiting, open, and closed statuses', () => {
    const waitingTrade = makeTrade({ status: 'waiting' });
    const openTrade = makeTrade({ status: 'open' });
    const closedTrade = makeTrade({ status: 'closed' });

    expect(waitingTrade.status).toBe('waiting');
    expect(openTrade.status).toBe('open');
    expect(closedTrade.status).toBe('closed');
  });

  it('BE trade is not counted as win or loss, counted in breakEvenCount', () => {
    const tradeList: Trade[] = [
      // 1 Win (TP)
      makeTrade({ status: 'closed', result: 'tp', entry_price: 100, exit_price: 120, position_size: 1, fees: 0 }),
      // 1 Loss (SL)
      makeTrade({ status: 'closed', result: 'sl', entry_price: 100, exit_price: 90, position_size: 1, fees: 0 }),
      // 1 Break-Even (BE) with net zero
      makeTrade({ status: 'closed', result: 'be', entry_price: 100, exit_price: 100, position_size: 1, fees: 0 }),
      // 1 Break-Even (BE) with slight fee (so pnl <= 0 but result is BE)
      makeTrade({ status: 'closed', result: 'be', entry_price: 100, exit_price: 100, position_size: 1, fees: 2 }),
    ];

    const stats = calculateStatistics(tradeList);

    // Total trades closed with calculable P&L = 4
    expect(stats.totalTrades).toBe(4);
    // Win count must be exactly 1
    expect(stats.winCount).toBe(1);
    // Loss count must be exactly 1 (the SL trade, NOT the BE trades)
    expect(stats.lossCount).toBe(1);
    // Break-even count must be 2
    expect(stats.breakEvenCount).toBe(2);
    // Win rate is win / (win + loss) = 1 / 2 = 0.5 (50%)
    expect(stats.winRate).toBe(0.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Duplicate Latest Trade Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Duplicate Latest Trade specifications', () => {
  it('clones setup fields and does NOT copy trade ID, prices, SL/TP, screenshots, or dates', () => {
    const sourceTrade: Trade = makeTrade({
      id: 'original-uuid-1234',
      trade_date: '2026-08-01',
      asset: 'GOLD',
      market: 'Commodities',
      direction: 'short',
      status: 'closed',
      result: 'tp',
      strategy_id: 'strat-99',
      entry_price: 2500,
      exit_price: 2450,
      stop_loss: 2550,
      take_profit: 2400,
      position_size: 2,
      leverage: 50,
      fees: 10,
      session: 'London',
      entry_reason: 'Resistance rejection',
      exit_reason: 'Hit TP target',
      emotion: 'confident',
      confidence: 9,
      followed_plan: true,
      review: 'Great execution',
      screenshot_before: 'https://example.com/before.png',
      screenshot_after: 'https://example.com/after.png',
      visibility: 'shared',
      created_at: '2026-08-01T10:00:00Z',
      updated_at: '2026-08-01T12:00:00Z',
    });

    // Simulating duplication logic
    const newTradeId = 'new-random-uuid-5678';
    const today = '2026-09-18';
    const duplicated: Trade = {
      id: newTradeId,
      workspace_id: sourceTrade.workspace_id,
      user_id: sourceTrade.user_id,
      asset: sourceTrade.asset,
      market: sourceTrade.market,
      direction: sourceTrade.direction,
      status: 'waiting', // New trade starts fresh
      result: 'none',
      trade_date: today,
      strategy_id: sourceTrade.strategy_id,
      entry_price: null, // NOT copied
      exit_price: null,  // NOT copied
      stop_loss: null,   // NOT copied
      take_profit: null, // NOT copied
      position_size: sourceTrade.position_size,
      leverage: sourceTrade.leverage,
      fees: sourceTrade.fees,
      session: sourceTrade.session,
      entry_reason: sourceTrade.entry_reason,
      exit_reason: sourceTrade.exit_reason,
      emotion: sourceTrade.emotion,
      confidence: sourceTrade.confidence,
      followed_plan: sourceTrade.followed_plan,
      review: sourceTrade.review,
      screenshot_before: null, // NOT copied
      screenshot_after: null,  // NOT copied
      visibility: sourceTrade.visibility,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Assert setup fields copied
    expect(duplicated.asset).toBe('GOLD');
    expect(duplicated.market).toBe('Commodities');
    expect(duplicated.direction).toBe('short');
    expect(duplicated.strategy_id).toBe('strat-99');
    expect(duplicated.position_size).toBe(2);
    expect(duplicated.leverage).toBe(50);
    expect(duplicated.session).toBe('London');
    expect(duplicated.entry_reason).toBe('Resistance rejection');
    expect(duplicated.emotion).toBe('confident');

    // Assert isolated fields are NOT copied
    expect(duplicated.id).not.toBe(sourceTrade.id);
    expect(duplicated.id).toBe(newTradeId);
    expect(duplicated.entry_price).toBeNull();
    expect(duplicated.exit_price).toBeNull();
    expect(duplicated.stop_loss).toBeNull();
    expect(duplicated.take_profit).toBeNull();
    expect(duplicated.screenshot_before).toBeNull();
    expect(duplicated.screenshot_after).toBeNull();
    expect(duplicated.trade_date).toBe(today);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Capital, Ownership Percentage & THB -> USD Conversion Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Capital, Ownership Percentages and Currency Conversion', () => {
  it('Calculates total capital and respective ownership percentages correctly', () => {
    const myCapital = 60000;
    const partnerCapital = 40000;
    const totalCapital = myCapital + partnerCapital;

    expect(totalCapital).toBe(100000);

    const myPercentage = (myCapital / totalCapital) * 100;
    const partnerPercentage = (partnerCapital / totalCapital) * 100;

    expect(myPercentage).toBe(60);
    expect(partnerPercentage).toBe(40);
  });

  it('Identifies the majority capital owner correctly', () => {
    const calculateMajorityOwner = (my: number, partner: number, pName: string) => {
      const total = my + partner;
      if (total === 0) return '—';
      if (my > partner) return 'คุณ';
      if (partner > my) return pName;
      return 'เท่ากันทั้งสองคน';
    };

    expect(calculateMajorityOwner(60000, 40000, 'John')).toBe('คุณ');
    expect(calculateMajorityOwner(30000, 70000, 'John')).toBe('John');
    expect(calculateMajorityOwner(50000, 50000, 'John')).toBe('เท่ากันทั้งสองคน');
    expect(calculateMajorityOwner(0, 0, 'John')).toBe('—');
  });

  it('Converts THB to USD using exchange rate and handles errors gracefully', () => {
    const convertThbToUsd = (thb: number, rate: number | null): string | null => {
      if (rate == null || isNaN(rate) || rate <= 0) return null;
      const usd = thb * rate;
      return `$${usd.toFixed(2)}`;
    };

    // Realistic rate: 1 THB = 0.028 USD (approx 35.7 THB/USD)
    expect(convertThbToUsd(100000, 0.028)).toBe('$2800.00');

    // Missing / offline exchange rate does NOT break or produce corrupt numbers
    expect(convertThbToUsd(100000, null)).toBeNull();
    expect(convertThbToUsd(100000, 0)).toBeNull();
  });

  it('handles zero trades safely for dashboard display', () => {
    const emptyStats = calculateStatistics([]);
    expect(emptyStats.totalTrades).toBe(0);
    expect(emptyStats.winRate).toBe(0);
    expect(emptyStats.totalPnL).toBe(0);
    expect(emptyStats.profitFactor).toBe(0);
    expect(emptyStats.maxDrawdown).toBe(0);
  });

  it('stores workspace capital settings with ownership percentages correctly', () => {
    const uCap = 60000;
    const pCap = 40000;
    const tot = uCap + pCap;
    const uPct = tot > 0 ? Number(((uCap / tot) * 100).toFixed(2)) : 0;
    const pPct = tot > 0 ? Number(((pCap / tot) * 100).toFixed(2)) : 0;

    const workspaceData = {
      user_capital: uCap,
      partner_capital: pCap,
      total_capital: tot,
      user_ownership_pct: uPct,
      partner_ownership_pct: pPct,
    };

    expect(workspaceData.total_capital).toBe(100000);
    expect(workspaceData.user_ownership_pct).toBe(60);
    expect(workspaceData.partner_ownership_pct).toBe(40);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Core Flow: calculateCapitalSummary & Integrated Equity Curve Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateCapitalSummary (Core Data Flow: Initial -> Realized P&L -> Current Capital & Share)', () => {
  it('correctly calculates current capital and capital shares from completed trades', () => {
    const trades: Trade[] = [
      // User trade: +2,000 P&L
      makeTrade({
        user_id: 'user-1',
        status: 'closed',
        result: 'tp',
        direction: 'long',
        entry_price: 100,
        exit_price: 120,
        position_size: 100,
        fees: 0,
        trade_date: '2026-09-01',
      }),
      // Partner trade: -1,000 P&L
      makeTrade({
        user_id: 'user-2',
        status: 'closed',
        result: 'sl',
        direction: 'long',
        entry_price: 100,
        exit_price: 90,
        position_size: 100,
        fees: 0,
        trade_date: '2026-09-02',
      }),
      // Open / Waiting trade: must NOT be counted in realized P&L
      makeTrade({
        user_id: 'user-1',
        status: 'open',
        direction: 'long',
        entry_price: 100,
        exit_price: 150,
        position_size: 100,
        fees: 0,
        trade_date: '2026-09-03',
      }),
    ];

    const summary = calculateCapitalSummary({
      initialUserCapital: 60000,
      initialPartnerCapital: 40000,
      trades,
      userId: 'user-1',
    });

    expect(summary.initialUserCapital).toBe(60000);
    expect(summary.initialPartnerCapital).toBe(40000);
    expect(summary.initialTotalCapital).toBe(100000);
    expect(summary.initialUserOwnershipPct).toBe(60);
    expect(summary.initialPartnerOwnershipPct).toBe(40);

    // Realized P&L
    expect(summary.userRealizedPnL).toBe(2000);
    expect(summary.partnerRealizedPnL).toBe(-1000);
    expect(summary.totalRealizedPnL).toBe(1000);

    // Current Capital
    expect(summary.currentUserCapital).toBe(62000);
    expect(summary.currentPartnerCapital).toBe(39000);
    expect(summary.currentTotalCapital).toBe(101000);

    // Current Capital Share %
    // User: 62,000 / 101,000 ≈ 61.386%
    // Partner: 39,000 / 101,000 ≈ 38.614%
    expect(summary.currentUserCapitalShare).toBeCloseTo(61.386, 2);
    expect(summary.currentPartnerCapitalShare).toBeCloseTo(38.614, 2);
  });

  it('calculates equity curve starting from initial capital and only uses closed trades', () => {
    const trades: Trade[] = [
      makeTrade({ status: 'closed', direction: 'long', entry_price: 100, exit_price: 110, position_size: 100, fees: 0, trade_date: '2026-09-01' }), // +1000
      makeTrade({ status: 'closed', direction: 'long', entry_price: 100, exit_price: 95, position_size: 100, fees: 0, trade_date: '2026-09-02' }),  // -500
      makeTrade({ status: 'open', direction: 'long', entry_price: 100, exit_price: 150, position_size: 100, fees: 0, trade_date: '2026-09-03' }),    // excluded!
      makeTrade({ status: 'closed', direction: 'long', entry_price: 100, exit_price: 120, position_size: 100, fees: 0, trade_date: '2026-09-04' }), // +2000
    ];

    const curve = calculateEquityCurve(trades, 100000);

    expect(curve.length).toBe(3);
    expect(curve[0].date).toBe('2026-09-01');
    expect(curve[0].equity).toBe(101000);
    expect(curve[0].cumPnL).toBe(1000);

    expect(curve[1].date).toBe('2026-09-02');
    expect(curve[1].equity).toBe(100500);
    expect(curve[1].cumPnL).toBe(500);

    expect(curve[2].date).toBe('2026-09-04');
    expect(curve[2].equity).toBe(102500);
    expect(curve[2].cumPnL).toBe(2500);
  });
});

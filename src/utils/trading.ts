/**
 * TradeTogether — Centralized Trading Calculations
 *
 * Single source of truth for all derived trading values.
 * These are CALCULATED, never user-entered.
 *
 * All monetary calculations use standard JS number arithmetic.
 * The database stores NUMERIC to avoid DB-level float issues,
 * but in-app we use number since JS doesn't have native decimal.
 * For a private trading journal this precision is sufficient.
 */

import type { Trade, TradeStatistics, EquityPoint, CapitalSummary } from '../types';

// ─── P&L ────────────────────────────────────────────────────────────────────

/**
 * Calculate P&L for a single trade.
 *
 * Long:  (exit - entry) × position_size - fees
 * Short: (entry - exit) × position_size - fees
 *
 * Returns null if required fields are missing.
 */
export function calculatePnL(trade: Trade): number | null {
  // If authoritative realized P&L is recorded on the trade, use it directly
  if (trade.pnl !== undefined && trade.pnl !== null) {
    return Number(trade.pnl);
  }

  const { entry_price, exit_price, position_size, direction, fees } = trade;
  if (entry_price == null || exit_price == null || position_size == null) {
    return null;
  }

  const rawPnL = direction === 'long'
    ? (exit_price - entry_price) * position_size
    : (entry_price - exit_price) * position_size;

  return rawPnL - (fees ?? 0);
}

// ─── P&L Percentage ─────────────────────────────────────────────────────────

/**
 * P&L as percentage of entry cost (entry_price × position_size).
 *
 * Formula: pnl / (entry_price × position_size) × 100
 *
 * This uses the total entry cost as denominator.
 * Deprioritized metric — included for completeness.
 */
export function calculatePnLPercent(trade: Trade): number | null {
  const pnl = calculatePnL(trade);
  const { entry_price, position_size } = trade;
  if (pnl == null || entry_price == null || position_size == null || entry_price === 0 || position_size === 0) {
    return null;
  }
  const entryCost = entry_price * position_size;
  if (entryCost === 0) return null;
  return (pnl / entryCost) * 100;
}

// ─── Risk ───────────────────────────────────────────────────────────────────

/**
 * Initial risk = |entry - stop_loss| × position_size
 * Returns null if stop_loss or required fields missing.
 */
export function calculateRisk(trade: Trade): number | null {
  const { entry_price, stop_loss, position_size } = trade;
  if (entry_price == null || stop_loss == null || position_size == null) {
    return null;
  }
  return Math.abs(entry_price - stop_loss) * position_size;
}

// ─── R-Multiple ─────────────────────────────────────────────────────────────

/**
 * R-Multiple = Net P&L / Initial Risk
 *
 * Returns null if P&L or risk cannot be calculated, or risk is zero.
 */
export function calculateRMultiple(trade: Trade): number | null {
  const pnl = calculatePnL(trade);
  const risk = calculateRisk(trade);
  if (pnl == null || risk == null || risk === 0) {
    return null;
  }
  return pnl / risk;
}

export function calculateCapitalSummary(params: {
  initialUserCapital: number;
  initialPartnerCapital: number;
  trades: Trade[];
  userId?: string;
}): CapitalSummary {
  const { initialUserCapital, initialPartnerCapital, trades, userId } = params;
  const initialTotalCapital = initialUserCapital + initialPartnerCapital;
  const initialUserOwnershipPct = initialTotalCapital > 0 ? (initialUserCapital / initialTotalCapital) * 100 : 50;
  const initialPartnerOwnershipPct = initialTotalCapital > 0 ? (initialPartnerCapital / initialTotalCapital) * 100 : 50;

  // Realized P&L from closed trades with valid P&L
  let userRealizedPnL = 0;
  let partnerRealizedPnL = 0;

  for (const t of trades) {
    if (t.status !== 'closed') continue;
    const pnl = calculatePnL(t);
    if (pnl === null) continue;

    if (userId && t.user_id === userId) {
      userRealizedPnL += pnl;
    } else if (userId) {
      partnerRealizedPnL += pnl;
    } else {
      // If no userId provided, check ownership via member
      userRealizedPnL += pnl;
    }
  }

  const totalRealizedPnL = userRealizedPnL + partnerRealizedPnL;
  const currentUserCapital = initialUserCapital + userRealizedPnL;
  const currentPartnerCapital = initialPartnerCapital + partnerRealizedPnL;
  const currentTotalCapital = currentUserCapital + currentPartnerCapital;

  const currentUserCapitalShare = currentTotalCapital > 0
    ? (currentUserCapital / currentTotalCapital) * 100
    : initialUserOwnershipPct;

  const currentPartnerCapitalShare = currentTotalCapital > 0
    ? (currentPartnerCapital / currentTotalCapital) * 100
    : initialPartnerOwnershipPct;

  return {
    initialUserCapital,
    initialPartnerCapital,
    initialTotalCapital,
    initialUserOwnershipPct,
    initialPartnerOwnershipPct,
    userRealizedPnL,
    partnerRealizedPnL,
    totalRealizedPnL,
    currentUserCapital,
    currentPartnerCapital,
    currentTotalCapital,
    currentUserCapitalShare,
    currentPartnerCapitalShare,
  };
}

// ─── Aggregate Statistics ───────────────────────────────────────────────────

/**
 * Calculate comprehensive statistics for a set of closed trades.
 * Only trades with status === 'closed' and calculable P&L are included.
 */
export function calculateStatistics(trades: Trade[]): TradeStatistics {
  const closedWithPnL = trades
    .filter(t => t.status === 'closed')
    .map(t => ({ trade: t, pnl: calculatePnL(t), r: calculateRMultiple(t) }))
    .filter((x): x is { trade: Trade; pnl: number; r: number | null } => x.pnl !== null);

  if (closedWithPnL.length === 0) {
    return {
      totalPnL: 0,
      winRate: 0,
      profitFactor: 0,
      averageWin: 0,
      averageLoss: 0,
      averageR: null,
      maxDrawdown: 0,
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      breakEvenCount: 0,
      expectancy: 0,
    };
  }

  // Separate BE trades vs Win / Loss
  // BE trades (where trade.result === 'be') must not count as either a win or a loss.
  const beTrades = closedWithPnL.filter(x => x.trade.result === 'be');
  const nonBeTrades = closedWithPnL.filter(x => x.trade.result !== 'be');

  // Wins: result === 'tp' or (no result and pnl > 0)
  // Losses: result === 'sl' or (no result and pnl <= 0)
  const wins = nonBeTrades.filter(x => x.trade.result === 'tp' || (!x.trade.result && x.pnl > 0));
  const losses = nonBeTrades.filter(x => x.trade.result === 'sl' || (!x.trade.result && x.pnl <= 0));

  const totalPnL = closedWithPnL.reduce((sum, x) => sum + x.pnl, 0);
  const grossWins = wins.reduce((sum, x) => sum + x.pnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, x) => sum + x.pnl, 0));

  // Win rate is wins out of decisive trades (excluding BE)
  const decisiveTradesCount = wins.length + losses.length;
  const winRate = decisiveTradesCount > 0 ? wins.length / decisiveTradesCount : 0;
  const profitFactor = grossLosses === 0 ? (grossWins > 0 ? Infinity : 0) : grossWins / grossLosses;
  const averageWin = wins.length > 0 ? grossWins / wins.length : 0;
  const averageLoss = losses.length > 0 ? grossLosses / losses.length : 0;

  // Average R (only trades with valid R)
  const withR = closedWithPnL.filter(x => x.r !== null) as { trade: Trade; pnl: number; r: number }[];
  const averageR = withR.length > 0
    ? withR.reduce((sum, x) => sum + x.r, 0) / withR.length
    : null;

  // Expectancy = (winRate × averageWin) - (lossRate × averageLoss)
  const lossRate = decisiveTradesCount > 0 ? losses.length / decisiveTradesCount : 0;
  const expectancy = (winRate * averageWin) - (lossRate * averageLoss);

  // Max drawdown
  const maxDrawdown = calculateMaxDrawdown(closedWithPnL.map(x => x.pnl));

  return {
    totalPnL,
    winRate,
    profitFactor,
    averageWin,
    averageLoss,
    averageR,
    maxDrawdown,
    totalTrades: closedWithPnL.length,
    winCount: wins.length,
    lossCount: losses.length,
    breakEvenCount: beTrades.length,
    expectancy,
  };
}

// ─── Max Drawdown ───────────────────────────────────────────────────────────

/**
 * Calculate maximum drawdown from a sequence of P&L values.
 * Returns a positive number representing the largest peak-to-trough decline.
 */
export function calculateMaxDrawdown(pnls: number[]): number {
  if (pnls.length === 0) return 0;

  let peak = 0;
  let cumulative = 0;
  let maxDD = 0;

  for (const pnl of pnls) {
    cumulative += pnl;
    if (cumulative > peak) {
      peak = cumulative;
    }
    const drawdown = peak - cumulative;
    if (drawdown > maxDD) {
      maxDD = drawdown;
    }
  }

  return maxDD;
}

// ─── Equity Curve ───────────────────────────────────────────────────────────

/**
 * Build equity curve data points from trades sorted chronologically.
 * If startingCapital is provided, equity = startingCapital + cumPnL.
 * Only closed trades with valid P&L contribute to the curve.
 */
export function calculateEquityCurve(trades: Trade[], startingCapital: number = 0): EquityPoint[] {
  const sorted = [...trades]
    .filter(t => t.status === 'closed')
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));

  let cumPnL = 0;
  const points: EquityPoint[] = [];

  for (let index = 0; index < sorted.length; index++) {
    const trade = sorted[index];
    const pnl = calculatePnL(trade);
    if (pnl !== null) {
      cumPnL += pnl;
      points.push({
        date: trade.trade_date,
        equity: startingCapital + cumPnL,
        cumPnL,
        tradeIndex: index,
      });
    }
  }

  return points;
}

// ─── Formatting Helpers ─────────────────────────────────────────────────────

const CURRENCY_CONFIG: Record<string, { symbol: string; locale: string }> = {
  THB: { symbol: '฿', locale: 'th-TH' },
  USD: { symbol: '$', locale: 'en-US' },
  EUR: { symbol: '€', locale: 'de-DE' },
};

export function formatCurrency(value: number, currency: string = 'THB'): string {
  const config = CURRENCY_CONFIG[currency] ?? CURRENCY_CONFIG.THB;
  const formatted = new Intl.NumberFormat(config.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
  return `${sign}${config.symbol}${formatted}`;
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatR(value: number | null): string {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}R`;
}

// ─── Automatic SL/TP Calculation (500 points) ──────────────────────────────

/**
 * Determine price precision (number of decimal places) from a price number or string.
 * Defaults to 2 decimal places if whole number (e.g. standard Gold / Forex / Crypto representation).
 */
export function getPricePrecision(price: number | string): number {
  const str = price.toString();
  if (str.includes('.')) {
    const decimals = str.split('.')[1].length;
    return Math.max(decimals, 2);
  }
  return 2;
}

/**
 * Automatically calculate SL and TP with a minimum distance of 500 points.
 * For Long:
 *   SL = Entry - 500 points
 *   TP = Entry + 500 points
 * For Short:
 *   SL = Entry + 500 points
 *   TP = Entry - 500 points
 *
 * 500 points means 500 price increments at the instrument's price precision:
 * E.g. for Gold with 2 decimals (1 point = 0.01):
 *   500 points = 500 × 0.01 = 5.00
 *   Entry: 2,500.00 -> Long: SL = 2,495.00, TP = 2,505.00
 *                   -> Short: SL = 2,505.00, TP = 2,495.00
 * E.g. for 3 decimals (1 point = 0.001):
 *   500 points = 500 × 0.001 = 0.500
 */
export function calculateAutoSlTp(
  entryPrice: number,
  direction: 'long' | 'short',
  distancePoints: number = 500,
  precision?: number
): { stopLoss: number; takeProfit: number; pointValue: number } {
  const decimals = precision !== undefined ? precision : getPricePrecision(entryPrice);
  const pointSize = Math.pow(10, -decimals);
  const diff = distancePoints * pointSize;

  const round = (val: number) => {
    return Number(val.toFixed(decimals));
  };

  if (direction === 'long') {
    return {
      stopLoss: round(entryPrice - diff),
      takeProfit: round(entryPrice + diff),
      pointValue: diff,
    };
  } else {
    return {
      stopLoss: round(entryPrice + diff),
      takeProfit: round(entryPrice - diff),
      pointValue: diff,
    };
  }
}

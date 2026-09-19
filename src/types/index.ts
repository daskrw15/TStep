// ─── Core Types ─────────────────────────────────────────────────────────────

export type Direction = 'long' | 'short';
export type TradeStatus = 'waiting' | 'open' | 'closed';
export type TradeResult = 'tp' | 'sl' | 'be' | 'none';
export type Visibility = 'private' | 'shared';
export type SyncStatus = 'synced' | 'pending' | 'error';
export type WorkspaceRole = 'owner' | 'member';
export type Currency = 'USD' | 'THB' | 'EUR';

export type Emotion =
  | 'calm'
  | 'confident'
  | 'nervous'
  | 'fear'
  | 'fomo'
  | 'angry'
  | 'tired'
  | 'excited';

export const EMOTIONS: Emotion[] = [
  'calm', 'confident', 'nervous', 'fear', 'fomo', 'angry', 'tired', 'excited',
];

export const CURRENCIES: { value: Currency; label: string; symbol: string }[] = [
  { value: 'THB', label: 'Thai Baht', symbol: '฿' },
  { value: 'USD', label: 'US Dollar', symbol: '$' },
  { value: 'EUR', label: 'Euro', symbol: '€' },
];

// ─── Database Records ───────────────────────────────────────────────────────

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  preferred_currency: Currency;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  invite_code: string | null; // null when viewed by non-owner
  created_by: string;
  user_capital?: number;
  partner_capital?: number;
  total_capital?: number;
  user_ownership_pct?: number;
  partner_ownership_pct?: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  capital?: number;
  joined_at: string;
  profile?: Profile; // joined
}

export interface Strategy {
  id: string;
  workspace_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Trade {
  id: string;
  workspace_id: string;
  user_id: string;
  asset: string;
  market: string | null;
  direction: Direction;
  status: TradeStatus;
  result?: TradeResult; // 'tp' | 'sl' | 'be' | 'none'
  trade_date: string; // ISO date
  strategy_id: string | null;
  entry_price: number | null;
  exit_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  position_size: number | null;
  leverage: number | null;
  fees: number | null;
  pnl?: number | null; // Authoritative realized P&L amount (e.g. entered via quick action or edit)
  session: string | null;
  entry_reason: string | null;
  exit_reason: string | null;
  emotion: Emotion | null;
  confidence: number | null; // 1-10
  followed_plan: boolean | null;
  review: string | null;
  screenshot_before: string | null;
  screenshot_after: string | null;
  visibility: Visibility;
  created_at: string;
  updated_at: string;
}

export interface JournalEntry {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  content: string;
  entry_date: string; // ISO date
  created_at: string;
  updated_at: string;
}

// ─── Local (IndexedDB) Records with sync metadata ──────────────────────────

export interface LocalTrade extends Trade {
  _sync_status: SyncStatus;
  _updated_at: string;
  _deleted_at: string | null;
}

export interface LocalJournalEntry extends JournalEntry {
  _sync_status: SyncStatus;
  _updated_at: string;
  _deleted_at: string | null;
}

export interface LocalStrategy extends Strategy {
  _sync_status: SyncStatus;
  _updated_at: string;
  _deleted_at: string | null;
}

// ─── Calculated Statistics ──────────────────────────────────────────────────

export interface TradeStatistics {
  totalPnL: number;
  winRate: number;        // 0–1
  profitFactor: number;   // gross wins / gross losses, Infinity if no losses
  averageWin: number;
  averageLoss: number;
  averageR: number | null;
  maxDrawdown: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  breakEvenCount: number;
  expectancy: number;
}

export interface CapitalSummary {
  initialUserCapital: number;
  initialPartnerCapital: number;
  initialTotalCapital: number;
  initialUserOwnershipPct: number;
  initialPartnerOwnershipPct: number;
  userRealizedPnL: number;
  partnerRealizedPnL: number;
  totalRealizedPnL: number;
  currentUserCapital: number;
  currentPartnerCapital: number;
  currentTotalCapital: number;
  currentUserCapitalShare: number;
  currentPartnerCapitalShare: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  cumPnL: number;
  tradeIndex: number;
}

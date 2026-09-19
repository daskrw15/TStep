/**
 * TradeTogether — Data Export / Import
 *
 * Export: trades + journal entries as JSON or CSV
 * Import: previously exported JSON with validation + confirmation
 */

import { db } from '../db';
import type { Trade, JournalEntry } from '../types';

// ─── Export ─────────────────────────────────────────────────────────────────

interface ExportData {
  version: 1;
  exported_at: string;
  trades: Trade[];
  journal_entries: JournalEntry[];
}

export async function exportAsJSON(workspaceId: string): Promise<string> {
  const trades = await db.trades
    .where('workspace_id').equals(workspaceId)
    .filter(t => !t._deleted_at)
    .toArray();

  const journalEntries = await db.journal_entries
    .where('workspace_id').equals(workspaceId)
    .filter(e => !e._deleted_at)
    .toArray();

  // Strip sync metadata for export
  const cleanTrades = trades.map(({ _sync_status, _updated_at, _deleted_at, ...t }) => t);
  const cleanEntries = journalEntries.map(({ _sync_status, _updated_at, _deleted_at, ...e }) => e);

  const data: ExportData = {
    version: 1,
    exported_at: new Date().toISOString(),
    trades: cleanTrades as Trade[],
    journal_entries: cleanEntries as JournalEntry[],
  };

  return JSON.stringify(data, null, 2);
}

export async function exportAsCSV(workspaceId: string): Promise<string> {
  const trades = await db.trades
    .where('workspace_id').equals(workspaceId)
    .filter(t => !t._deleted_at)
    .toArray();

  if (trades.length === 0) return '';

  const headers = [
    'id', 'asset', 'market', 'direction', 'status', 'result', 'trade_date',
    'entry_price', 'exit_price', 'stop_loss', 'take_profit',
    'position_size', 'leverage', 'fees', 'session',
    'entry_reason', 'exit_reason', 'emotion', 'confidence',
    'followed_plan', 'review', 'visibility', 'created_at',
  ];

  const rows = trades.map(t =>
    headers.map(h => {
      const val = (t as unknown as Record<string, unknown>)[h];
      if (val == null) return '';
      const str = String(val);
      // Escape CSV
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Import ─────────────────────────────────────────────────────────────────

export interface ImportResult {
  tradesImported: number;
  journalEntriesImported: number;
  tradesSkipped: number;
  journalEntriesSkipped: number;
  errors: string[];
}

export function validateImportData(raw: unknown): { valid: boolean; data?: ExportData; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Invalid JSON structure' };
  }

  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    return { valid: false, error: 'Unsupported export version' };
  }
  if (!Array.isArray(obj.trades)) {
    return { valid: false, error: 'Missing or invalid trades array' };
  }
  if (!Array.isArray(obj.journal_entries)) {
    return { valid: false, error: 'Missing or invalid journal_entries array' };
  }

  // Basic validation of trade records
  for (const t of obj.trades) {
    if (!t.id || !t.asset || !t.direction) {
      return { valid: false, error: `Invalid trade record: missing required fields (id, asset, direction)` };
    }
  }

  return { valid: true, data: obj as unknown as ExportData };
}

export async function importFromJSON(
  jsonString: string,
  workspaceId: string,
  userId: string
): Promise<ImportResult> {
  const result: ImportResult = {
    tradesImported: 0,
    journalEntriesImported: 0,
    tradesSkipped: 0,
    journalEntriesSkipped: 0,
    errors: [],
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    result.errors.push('Invalid JSON');
    return result;
  }

  const validation = validateImportData(parsed);
  if (!validation.valid || !validation.data) {
    result.errors.push(validation.error ?? 'Validation failed');
    return result;
  }

  const { trades, journal_entries } = validation.data;

  // Import trades — skip existing IDs
  for (const trade of trades) {
    try {
      const existing = await db.trades.get(trade.id);
      if (existing) {
        result.tradesSkipped++;
        continue;
      }
      await db.trades.put({
        ...trade,
        workspace_id: workspaceId,
        user_id: userId,
        _sync_status: 'pending',
        _updated_at: new Date().toISOString(),
        _deleted_at: null,
      });
      result.tradesImported++;
    } catch (err) {
      result.errors.push(`Trade ${trade.id}: ${err}`);
    }
  }

  // Import journal entries — skip existing IDs
  for (const entry of journal_entries) {
    try {
      const existing = await db.journal_entries.get(entry.id);
      if (existing) {
        result.journalEntriesSkipped++;
        continue;
      }
      await db.journal_entries.put({
        ...entry,
        workspace_id: workspaceId,
        user_id: userId,
        _sync_status: 'pending',
        _updated_at: new Date().toISOString(),
        _deleted_at: null,
      });
      result.journalEntriesImported++;
    } catch (err) {
      result.errors.push(`Journal ${entry.id}: ${err}`);
    }
  }

  return result;
}

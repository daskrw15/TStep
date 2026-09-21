import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, withSyncMeta } from '../../db';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { syncToCloud } from '../../services/sync';
import { uploadScreenshot, getScreenshotUrl, validateScreenshotFile, deleteScreenshot } from '../../services/storage';
import type { Direction, TradeStatus, TradeResult, Visibility, Emotion, Trade, LocalStrategy } from '../../types';
import { EMOTIONS } from '../../types';
import { EMOTION_LABELS, STATUS_LABELS, RESULT_LABELS } from '../../locales/translations';
import { calculateAutoSlTp } from '../../utils/trading';
import { format } from 'date-fns';

export default function AddTradePage() {
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;

  const existingTrade = useLiveQuery(
    () => id ? db.trades.get(id) : undefined,
    [id]
  );

  const strategies = useLiveQuery<LocalStrategy[]>(
    () => workspace
      ? db.strategies.where('workspace_id').equals(workspace.id).filter(s => !s._deleted_at).toArray()
      : [],
    [workspace?.id]
  );

  // Query most recent saved trade for current user to allow duplicating setup
  const latestTrade = useLiveQuery<Trade | undefined>(
    async () => {
      if (isEdit || !workspace || !user) return undefined;
      const userTrades = await db.trades
        .where('workspace_id')
        .equals(workspace.id)
        .filter(t => !t._deleted_at && t.user_id === user.id)
        .toArray();
      if (userTrades.length === 0) return undefined;
      userTrades.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return userTrades[0];
    },
    [isEdit, workspace?.id, user?.id]
  );

  // Form state
  const [asset, setAsset] = useState('');
  const [market, setMarket] = useState('');
  const [direction, setDirection] = useState<Direction>('long');
  const [status, setStatus] = useState<TradeStatus>('closed');
  const [result, setResult] = useState<TradeResult>('none');
  const [pnlInput, setPnlInput] = useState('');
  const [tradeDate, setTradeDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [strategyId, setStrategyId] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [positionSize, setPositionSize] = useState('');
  const [leverage, setLeverage] = useState('');
  const [fees, setFees] = useState('');
  const [session, setSession] = useState('');
  const [entryReason, setEntryReason] = useState('');
  const [exitReason, setExitReason] = useState('');
  const [emotion, setEmotion] = useState<Emotion | ''>('');
  const [confidence, setConfidence] = useState(5);
  const [followedPlan, setFollowedPlan] = useState<boolean | null>(null);
  const [review, setReview] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('shared');

  // Screenshot states
  const [screenshotBefore, setScreenshotBefore] = useState<File | null>(null);
  const [screenshotAfter, setScreenshotAfter] = useState<File | null>(null);
  const [existingBeforePath, setExistingBeforePath] = useState<string | null>(null);
  const [existingAfterPath, setExistingAfterPath] = useState<string | null>(null);
  const [previewBeforeUrl, setPreviewBeforeUrl] = useState<string | null>(null);
  const [previewAfterUrl, setPreviewAfterUrl] = useState<string | null>(null);
  const [fileBeforeSize, setFileBeforeSize] = useState<string | null>(null);
  const [fileAfterSize, setFileAfterSize] = useState<string | null>(null);
  const [isDraggingBefore, setIsDraggingBefore] = useState(false);
  const [isDraggingAfter, setIsDraggingAfter] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);

  // Hidden file input refs
  const beforeFileInputRef = useRef<HTMLInputElement>(null);
  const beforeCameraInputRef = useRef<HTMLInputElement>(null);
  const afterFileInputRef = useRef<HTMLInputElement>(null);
  const afterCameraInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Flags to track if SL/TP were manually edited by user
  const [isSlManuallyEdited, setIsSlManuallyEdited] = useState(false);
  const [isTpManuallyEdited, setIsTpManuallyEdited] = useState(false);

  // Populate form for edit mode
  useEffect(() => {
    if (existingTrade) {
      setAsset(existingTrade.asset);
      setMarket(existingTrade.market ?? '');
      setDirection(existingTrade.direction);
      setStatus(existingTrade.status);
      setResult(existingTrade.result ?? 'none');
      setPnlInput(existingTrade.pnl != null ? existingTrade.pnl.toString() : '');
      setTradeDate(existingTrade.trade_date);
      setStrategyId(existingTrade.strategy_id ?? '');
      setEntryPrice(existingTrade.entry_price?.toString() ?? '');
      setExitPrice(existingTrade.exit_price?.toString() ?? '');
      setStopLoss(existingTrade.stop_loss?.toString() ?? '');
      setTakeProfit(existingTrade.take_profit?.toString() ?? '');
      setPositionSize(existingTrade.position_size?.toString() ?? '');
      setLeverage(existingTrade.leverage?.toString() ?? '');
      setFees(existingTrade.fees?.toString() ?? '');
      setSession(existingTrade.session ?? '');
      setEntryReason(existingTrade.entry_reason ?? '');
      setExitReason(existingTrade.exit_reason ?? '');
      setEmotion(existingTrade.emotion ?? '');
      setConfidence(existingTrade.confidence ?? 5);
      setFollowedPlan(existingTrade.followed_plan);
      setReview(existingTrade.review ?? '');
      setVisibility(existingTrade.visibility);
      // In edit mode, existing SL/TP should be preserved
      if (existingTrade.stop_loss != null) setIsSlManuallyEdited(true);
      if (existingTrade.take_profit != null) setIsTpManuallyEdited(true);

      // Existing screenshots
      if (existingTrade.screenshot_before) {
        setExistingBeforePath(existingTrade.screenshot_before);
        getScreenshotUrl(existingTrade.screenshot_before).then(url => {
          if (url) setPreviewBeforeUrl(url);
        });
      }
      if (existingTrade.screenshot_after) {
        setExistingAfterPath(existingTrade.screenshot_after);
        getScreenshotUrl(existingTrade.screenshot_after).then(url => {
          if (url) setPreviewAfterUrl(url);
        });
      }
    }
  }, [existingTrade]);

  // Handler for duplicating latest trade
  const handleDuplicateLatest = () => {
    if (!latestTrade) return;
    setAsset(latestTrade.asset);
    setMarket(latestTrade.market ?? '');
    setDirection(latestTrade.direction);
    setStrategyId(latestTrade.strategy_id ?? '');
    setPositionSize(latestTrade.position_size?.toString() ?? '');
    setLeverage(latestTrade.leverage?.toString() ?? '');
    setFees(latestTrade.fees?.toString() ?? '');
    setSession(latestTrade.session ?? '');
    setEntryReason(latestTrade.entry_reason ?? '');
    setExitReason(latestTrade.exit_reason ?? '');
    setEmotion(latestTrade.emotion ?? '');
    setConfidence(latestTrade.confidence ?? 5);
    setFollowedPlan(latestTrade.followed_plan);
    setReview(latestTrade.review ?? '');
    setVisibility(latestTrade.visibility);
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Helper to recompute auto SL/TP
  const applyAutoSlTp = (entryVal: string, dir: Direction) => {
    const num = Number(entryVal);
    if (!entryVal.trim() || isNaN(num) || num <= 0) {
      if (!isSlManuallyEdited) setStopLoss('');
      if (!isTpManuallyEdited) setTakeProfit('');
      return;
    }
    const auto = calculateAutoSlTp(num, dir, 500);
    if (!isSlManuallyEdited) {
      setStopLoss(auto.stopLoss.toString());
    }
    if (!isTpManuallyEdited) {
      setTakeProfit(auto.takeProfit.toString());
    }
  };

  const handleEntryPriceChange = (val: string) => {
    setEntryPrice(val);
    applyAutoSlTp(val, direction);
  };

  const handleDirectionChange = (newDir: Direction) => {
    setDirection(newDir);
    applyAutoSlTp(entryPrice, newDir);
  };

  const parseNum = (v: string) => v.trim() ? Number(v) : null;

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSelectBeforeFile = (file: File | null) => {
    if (!file) return;
    const { valid, error: validationErr } = validateScreenshotFile(file);
    if (!valid) {
      setError(validationErr ?? 'ไฟล์ไม่ถูกต้อง');
      return;
    }
    setError('');
    setScreenshotBefore(file);
    setFileBeforeSize(formatFileSize(file.size));
    setPreviewBeforeUrl(URL.createObjectURL(file));
  };

  const handleSelectAfterFile = (file: File | null) => {
    if (!file) return;
    const { valid, error: validationErr } = validateScreenshotFile(file);
    if (!valid) {
      setError(validationErr ?? 'ไฟล์ไม่ถูกต้อง');
      return;
    }
    setError('');
    setScreenshotAfter(file);
    setFileAfterSize(formatFileSize(file.size));
    setPreviewAfterUrl(URL.createObjectURL(file));
  };

  // Clipboard Paste Listener (Ctrl+V / Browser Paste)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      // Allow standard text paste inside text fields
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') &&
        (target as HTMLInputElement).type !== 'file'
      ) {
        const items = e.clipboardData?.items;
        if (!items) return;
        let hasImage = false;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            hasImage = true;
            break;
          }
        }
        if (!hasImage) return; // Normal text paste
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            // Automatically assign to Before if empty, otherwise After
            if (!previewBeforeUrl && !existingBeforePath) {
              handleSelectBeforeFile(file);
              setPasteNotice('วางภาพลงใน "ภาพก่อนเข้าสถานะ (Before)" สำเร็จ');
            } else {
              handleSelectAfterFile(file);
              setPasteNotice('วางภาพลงใน "ภาพหลังปิดสถานะ (After)" สำเร็จ');
            }
            setTimeout(() => setPasteNotice(null), 3500);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [previewBeforeUrl, existingBeforePath, previewAfterUrl, existingAfterPath]);

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent, slot: 'before' | 'after') => {
    e.preventDefault();
    e.stopPropagation();
    if (slot === 'before') setIsDraggingBefore(true);
    else setIsDraggingAfter(true);
  };

  const handleDragLeave = (e: React.DragEvent, slot: 'before' | 'after') => {
    e.preventDefault();
    e.stopPropagation();
    if (slot === 'before') setIsDraggingBefore(false);
    else setIsDraggingAfter(false);
  };

  const handleDrop = (e: React.DragEvent, slot: 'before' | 'after') => {
    e.preventDefault();
    e.stopPropagation();
    if (slot === 'before') setIsDraggingBefore(false);
    else setIsDraggingAfter(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (slot === 'before') handleSelectBeforeFile(file);
      else handleSelectAfterFile(file);
    }
  };

  const handleRemoveBeforeScreenshot = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScreenshotBefore(null);
    setExistingBeforePath(null);
    setPreviewBeforeUrl(null);
    setFileBeforeSize(null);
  };

  const handleRemoveAfterScreenshot = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScreenshotAfter(null);
    setExistingAfterPath(null);
    setPreviewAfterUrl(null);
    setFileAfterSize(null);
  };

  const handleDeleteTrade = async () => {
    if (!existingTrade || !id) return;
    setDeleting(true);
    try {
      // Soft-delete locally and set pending sync status
      await db.trades.update(id, {
        _sync_status: 'pending',
        _deleted_at: new Date().toISOString(),
        _updated_at: new Date().toISOString(),
      });

      // Clean up associated screenshots from Supabase Storage if present
      if (existingTrade.screenshot_before) {
        deleteScreenshot(existingTrade.screenshot_before).catch(() => {});
      }
      if (existingTrade.screenshot_after) {
        deleteScreenshot(existingTrade.screenshot_after).catch(() => {});
      }

      // Trigger background sync to delete from Supabase
      syncToCloud().catch(() => {});

      setShowDeleteConfirm(false);
      navigate('/trades');
    } catch (err) {
      console.error('Error deleting trade:', err);
      setError('เกิดข้อผิดพลาดในการลบรายการเทรด');
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!asset.trim()) {
      setError('กรุณาระบุชื่อสินทรัพย์ (Asset)');
      return;
    }
    if (!workspace || !user) {
      setError('ไม่พบพื้นที่เทรดหรือข้อมูลผู้ใช้');
      return;
    }

    setSaving(true);

    const tradeId = isEdit ? id! : crypto.randomUUID();

    // Upload screenshots if provided
    let screenshotBeforePath = existingBeforePath;
    let screenshotAfterPath = existingAfterPath;
    const uploadWarnings: string[] = [];

    if (screenshotBefore) {
      const res = await uploadScreenshot(screenshotBefore, workspace.id, tradeId, 'before');
      if (res.error) {
        uploadWarnings.push(`ภาพก่อนเข้า: ${res.error}`);
      } else {
        screenshotBeforePath = res.path;
      }
    }
    if (screenshotAfter) {
      const res = await uploadScreenshot(screenshotAfter, workspace.id, tradeId, 'after');
      if (res.error) {
        uploadWarnings.push(`ภาพหลังปิด: ${res.error}`);
      } else {
        screenshotAfterPath = res.path;
      }
    }

    const now = new Date().toISOString();
    const tradeData: Trade = {
      id: tradeId,
      workspace_id: workspace.id,
      user_id: existingTrade?.user_id ?? user.id,
      asset: asset.trim().toUpperCase(),
      market: market.trim() || null,
      direction,
      status,
      result,
      pnl: parseNum(pnlInput),
      trade_date: tradeDate,
      strategy_id: strategyId || null,
      entry_price: parseNum(entryPrice),
      exit_price: parseNum(exitPrice),
      stop_loss: parseNum(stopLoss),
      take_profit: parseNum(takeProfit),
      position_size: parseNum(positionSize),
      leverage: parseNum(leverage),
      fees: parseNum(fees),
      session: session.trim() || null,
      entry_reason: entryReason.trim() || null,
      exit_reason: exitReason.trim() || null,
      emotion: (emotion as Emotion) || null,
      confidence,
      followed_plan: followedPlan,
      review: review.trim() || null,
      screenshot_before: screenshotBeforePath,
      screenshot_after: screenshotAfterPath,
      visibility,
      created_at: existingTrade?.created_at ?? now,
      updated_at: now,
    };

    try {
      await db.trades.put(withSyncMeta(tradeData, 'pending'));
      syncToCloud().catch(() => {});
    } catch (err) {
      console.error('Error saving trade to local database:', err);
      setError('ไม่สามารถบันทึกข้อมูลรายการเทรดลงฐานข้อมูลได้');
      setSaving(false);
      return;
    }

    setSaving(false);

    if (uploadWarnings.length > 0) {
      alert(`บันทึกข้อมูลการเทรดสำเร็จ แต่อัปโหลดรูปภาพบางรูปไม่สำเร็จ:\n- ${uploadWarnings.join('\n- ')}`);
    }

    navigate('/trades');
  };

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <h1 className="page-title">{isEdit ? 'แก้ไขรายการเทรด' : 'เพิ่มรายการเทรด'}</h1>
        {!isEdit && latestTrade && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleDuplicateLatest}
            title="นำค่าตั้งต้นจากรายการล่าสุดของคุณมาใช้"
          >
            📋 ใช้รายการล่าสุด
          </button>
        )}
      </div>

      {error && <div className="auth-error mb-4">{error}</div>}

      <form onSubmit={handleSubmit}>
        {/* Basic */}
        <div className="form-section">
          <div className="form-section-title">ข้อมูลพื้นฐาน (Basic)</div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="asset">สินทรัพย์ (Asset) *</label>
              <input id="asset" value={asset} onChange={e => setAsset(e.target.value)} placeholder="เช่น BTCUSDT, XAUUSD" required />
            </div>
            <div className="form-group">
              <label htmlFor="market">ตลาด (Market)</label>
              <input id="market" value={market} onChange={e => setMarket(e.target.value)} placeholder="เช่น Crypto, Forex, หุ้นไทย" />
            </div>
          </div>
          <div className="form-group">
            <label>ทิศทาง (Direction)</label>
            <div className="direction-toggle">
              <button type="button" className={direction === 'long' ? 'active-long' : ''} onClick={() => handleDirectionChange('long')}>Long</button>
              <button type="button" className={direction === 'short' ? 'active-short' : ''} onClick={() => handleDirectionChange('short')}>Short</button>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="tradeDate">วันที่</label>
              <input id="tradeDate" type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="status">สถานะ (Status)</label>
              <select id="status" value={status} onChange={e => setStatus(e.target.value as TradeStatus)}>
                <option value="waiting">{STATUS_LABELS.waiting}</option>
                <option value="open">{STATUS_LABELS.open}</option>
                <option value="closed">{STATUS_LABELS.closed}</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="result">ผลลัพธ์การเทรด (Trade Result)</label>
              <select id="result" value={result} onChange={e => setResult(e.target.value as TradeResult)}>
                <option value="none">{RESULT_LABELS.none}</option>
                <option value="tp">TP (Take Profit)</option>
                <option value="sl">SL (Stop Loss)</option>
                <option value="be">BE (Break-Even เสมอตัว)</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="pnl">Realized P&L (USD) / ผลกำไร-ขาดทุนจริง</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>$</span>
                <input
                  id="pnl"
                  type="number"
                  step="any"
                  value={pnlInput}
                  onChange={e => setPnlInput(e.target.value)}
                  placeholder="เช่น 125.50 หรือ -75.25"
                  style={{ paddingLeft: '28px' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Trade */}
        <div className="form-section">
          <div className="form-section-title">การตั้งราคาและขนาด (Trade)</div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="entryPrice">ราคาเข้า (Entry Price)</label>
              <input
                id="entryPrice"
                type="number"
                step="any"
                value={entryPrice}
                onChange={e => handleEntryPriceChange(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="form-group">
              <label htmlFor="exitPrice">ราคาออก (Exit Price)</label>
              <input id="exitPrice" type="number" step="any" value={exitPrice} onChange={e => setExitPrice(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="stopLoss">
                Stop Loss {!isSlManuallyEdited && entryPrice && <span className="text-muted" style={{ fontSize: '0.75rem' }}>(คำนวณอัตโนมัติ 500 จุด)</span>}
              </label>
              <input
                id="stopLoss"
                type="number"
                step="any"
                value={stopLoss}
                onChange={e => {
                  setStopLoss(e.target.value);
                  setIsSlManuallyEdited(true);
                }}
                placeholder="0.00"
              />
            </div>
            <div className="form-group">
              <label htmlFor="takeProfit">
                Take Profit {!isTpManuallyEdited && entryPrice && <span className="text-muted" style={{ fontSize: '0.75rem' }}>(คำนวณอัตโนมัติ 500 จุด)</span>}
              </label>
              <input
                id="takeProfit"
                type="number"
                step="any"
                value={takeProfit}
                onChange={e => {
                  setTakeProfit(e.target.value);
                  setIsTpManuallyEdited(true);
                }}
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="positionSize">ขนาดสถานะ (Position Size)</label>
              <input id="positionSize" type="number" step="any" value={positionSize} onChange={e => setPositionSize(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label htmlFor="leverage">Leverage</label>
              <input id="leverage" type="number" step="any" value={leverage} onChange={e => setLeverage(e.target.value)} placeholder="เช่น 1, 10, 50, 100" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="fees">ค่าธรรมเนียม (Fees)</label>
              <input id="fees" type="number" step="any" value={fees} onChange={e => setFees(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label htmlFor="session">ช่วงเวลาเทรด (Session)</label>
              <input id="session" type="text" value={session} onChange={e => setSession(e.target.value)} placeholder="เช่น London, New York, Asia" />
            </div>
          </div>
        </div>

        {/* Strategy */}
        <div className="form-section">
          <div className="form-section-title">กลยุทธ์ (Strategy)</div>
          <div className="form-group">
            <label htmlFor="strategy">เลือกกลยุทธ์</label>
            <select id="strategy" value={strategyId} onChange={e => setStrategyId(e.target.value)}>
              <option value="">— ไม่ระบุ —</option>
              {(strategies ?? []).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Reason */}
        <div className="form-section">
          <div className="form-section-title">เหตุผลในการเทรด (Reason)</div>
          <div className="form-group">
            <label htmlFor="entryReason">เหตุผลในการเข้าสถานะ (Entry Reason)</label>
            <textarea id="entryReason" value={entryReason} onChange={e => setEntryReason(e.target.value)} placeholder="ระบุสัญญาณ เหตุผล หรือ setup ในการเข้า…" />
          </div>
          <div className="form-group">
            <label htmlFor="exitReason">เหตุผลในการออกสถานะ (Exit Reason)</label>
            <textarea id="exitReason" value={exitReason} onChange={e => setExitReason(e.target.value)} placeholder="ระบุเหตุผลในการปิดสถานะ เช่น ชน TP, ชน SL หรือปิดตามสัญญาณ…" />
          </div>
        </div>

        {/* Psychology */}
        <div className="form-section">
          <div className="form-section-title">จิตวิทยาและสภาวะอารมณ์ (Psychology)</div>
          <div className="form-group">
            <label>สภาวะอารมณ์ขณะเทรด</label>
            <div className="emotion-grid">
              {EMOTIONS.map(em => (
                <button
                  key={em}
                  type="button"
                  className={`emotion-chip ${emotion === em ? 'selected' : ''}`}
                  onClick={() => setEmotion(emotion === em ? '' : em)}
                >
                  {EMOTION_LABELS[em]}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="confidence">ระดับความมั่นใจ: {confidence}/10</label>
            <input
              id="confidence"
              type="range"
              min="1"
              max="10"
              value={confidence}
              onChange={e => setConfidence(Number(e.target.value))}
              className="confidence-slider"
            />
          </div>
        </div>

        {/* Review */}
        <div className="form-section">
          <div className="form-section-title">การทบทวน (Review)</div>
          <div className="form-group">
            <label>ได้ทำตามแผนที่วางไว้หรือไม่?</label>
            <div className="yesno-toggle">
              <button type="button" className={followedPlan === true ? 'active-yes' : ''} onClick={() => setFollowedPlan(followedPlan === true ? null : true)}>ใช่</button>
              <button type="button" className={followedPlan === false ? 'active-no' : ''} onClick={() => setFollowedPlan(followedPlan === false ? null : false)}>ไม่ใช่</button>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="review">สิ่งที่ได้เรียนรู้จากไม้นี้</label>
            <textarea id="review" value={review} onChange={e => setReview(e.target.value)} placeholder="บันทึกข้อคิด ความผิดพลาด หรือสิ่งที่จะทำให้ดีขึ้นในครั้งต่อไป…" />
          </div>
        </div>

        {/* Screenshots */}
        <div className="form-section">
          <div className="form-section-title flex justify-between items-center">
            <span>ภาพกราฟ (Screenshots)</span>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'none' }}>
              💡 วางภาพด้วย Ctrl+V ได้ทุกที่ในหน้านี้
            </span>
          </div>

          {pasteNotice && (
            <div className="badge badge-positive mb-3" style={{ padding: '6px 12px', fontSize: '12px', width: '100%', justifyContent: 'center' }}>
              📋 {pasteNotice}
            </div>
          )}

          <div className="form-row">
            {/* Hidden Inputs for Before */}
            <input
              ref={beforeFileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => handleSelectBeforeFile(e.target.files?.[0] ?? null)}
            />
            <input
              ref={beforeCameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={e => handleSelectBeforeFile(e.target.files?.[0] ?? null)}
            />

            {/* Before Slot */}
            <div className="form-group">
              <label className="flex justify-between items-center mb-1">
                <span>ภาพก่อนเข้าสถานะ (Before)</span>
                {fileBeforeSize && <span className="badge badge-neutral">{fileBeforeSize}</span>}
              </label>

              {previewBeforeUrl ? (
                <div style={{ position: 'relative', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--color-border)', background: 'var(--color-bg-card)' }}>
                  <div
                    style={{ position: 'relative', cursor: 'zoom-in', maxHeight: '240px', overflow: 'hidden', background: '#000' }}
                    onClick={() => setLightboxUrl(previewBeforeUrl)}
                    title="คลิกเพื่อดูภาพขยาย"
                  >
                    <img
                      src={previewBeforeUrl}
                      alt="Before preview"
                      style={{ width: '100%', height: '220px', objectFit: 'contain', display: 'block' }}
                    />
                    <div style={{ position: 'absolute', bottom: '8px', right: '8px', background: 'rgba(0,0,0,0.7)', padding: '3px 8px', borderRadius: 'var(--radius-sm)', fontSize: '11px', color: '#fff' }}>
                      🔍 ดูภาพขยาย
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', padding: '10px', background: 'var(--color-bg-card)', borderTop: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => beforeFileInputRef.current?.click()}>
                      📁 เปลี่ยนไฟล์
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => beforeCameraInputRef.current?.click()}>
                      📷 ถ่ายใหม่
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm text-negative" onClick={handleRemoveBeforeScreenshot}>
                      ลบภาพ
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`screenshot-upload ${isDraggingBefore ? 'active-drag' : ''}`}
                  onDragOver={e => handleDragOver(e, 'before')}
                  onDragLeave={e => handleDragLeave(e, 'before')}
                  onDrop={e => handleDrop(e, 'before')}
                  onClick={() => beforeFileInputRef.current?.click()}
                  style={{
                    borderStyle: isDraggingBefore ? 'solid' : 'dashed',
                    borderColor: isDraggingBefore ? 'var(--color-accent)' : undefined,
                    background: isDraggingBefore ? 'var(--color-accent-subtle)' : undefined,
                  }}
                >
                  <div style={{ fontSize: '1.75rem', marginBottom: '6px' }}>📸</div>
                  <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {isDraggingBefore ? 'ปล่อยเพื่อวางภาพที่นี่' : 'คลิกหรือลากไฟล์ภาพมาวางที่นี่'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px', marginBottom: '10px' }}>
                    PNG, JPG, WebP, GIF, HEIC (สูงสุด 40 MB)
                  </div>
                  <div className="flex justify-center gap-2" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => beforeFileInputRef.current?.click()}
                    >
                      📁 เลือกจากคลังภาพ
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => beforeCameraInputRef.current?.click()}
                    >
                      📷 ถ่ายภาพ
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Hidden Inputs for After */}
            <input
              ref={afterFileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => handleSelectAfterFile(e.target.files?.[0] ?? null)}
            />
            <input
              ref={afterCameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={e => handleSelectAfterFile(e.target.files?.[0] ?? null)}
            />

            {/* After Slot */}
            <div className="form-group">
              <label className="flex justify-between items-center mb-1">
                <span>ภาพหลังปิดสถานะ (After)</span>
                {fileAfterSize && <span className="badge badge-neutral">{fileAfterSize}</span>}
              </label>

              {previewAfterUrl ? (
                <div style={{ position: 'relative', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--color-border)', background: 'var(--color-bg-card)' }}>
                  <div
                    style={{ position: 'relative', cursor: 'zoom-in', maxHeight: '240px', overflow: 'hidden', background: '#000' }}
                    onClick={() => setLightboxUrl(previewAfterUrl)}
                    title="คลิกเพื่อดูภาพขยาย"
                  >
                    <img
                      src={previewAfterUrl}
                      alt="After preview"
                      style={{ width: '100%', height: '220px', objectFit: 'contain', display: 'block' }}
                    />
                    <div style={{ position: 'absolute', bottom: '8px', right: '8px', background: 'rgba(0,0,0,0.7)', padding: '3px 8px', borderRadius: 'var(--radius-sm)', fontSize: '11px', color: '#fff' }}>
                      🔍 ดูภาพขยาย
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', padding: '10px', background: 'var(--color-bg-card)', borderTop: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => afterFileInputRef.current?.click()}>
                      📁 เปลี่ยนไฟล์
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => afterCameraInputRef.current?.click()}>
                      📷 ถ่ายใหม่
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm text-negative" onClick={handleRemoveAfterScreenshot}>
                      ลบภาพ
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`screenshot-upload ${isDraggingAfter ? 'active-drag' : ''}`}
                  onDragOver={e => handleDragOver(e, 'after')}
                  onDragLeave={e => handleDragLeave(e, 'after')}
                  onDrop={e => handleDrop(e, 'after')}
                  onClick={() => afterFileInputRef.current?.click()}
                  style={{
                    borderStyle: isDraggingAfter ? 'solid' : 'dashed',
                    borderColor: isDraggingAfter ? 'var(--color-accent)' : undefined,
                    background: isDraggingAfter ? 'var(--color-accent-subtle)' : undefined,
                  }}
                >
                  <div style={{ fontSize: '1.75rem', marginBottom: '6px' }}>📸</div>
                  <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {isDraggingAfter ? 'ปล่อยเพื่อวางภาพที่นี่' : 'คลิกหรือลากไฟล์ภาพมาวางที่นี่'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px', marginBottom: '10px' }}>
                    PNG, JPG, WebP, GIF, HEIC (สูงสุด 40 MB)
                  </div>
                  <div className="flex justify-center gap-2" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => afterFileInputRef.current?.click()}
                    >
                      📁 เลือกจากคลังภาพ
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => afterCameraInputRef.current?.click()}
                    >
                      📷 ถ่ายภาพ
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Visibility */}
        <div className="form-section">
          <div className="form-section-title">การมองเห็น (Visibility)</div>
          <div className="form-group">
            <select value={visibility} onChange={e => setVisibility(e.target.value as Visibility)}>
              <option value="shared">แชร์กับคู่เทรด — มองเห็นได้ทั้งสองคน</option>
              <option value="private">ส่วนตัว — มองเห็นได้เฉพาะฉันเท่านั้น</option>
            </select>
          </div>
        </div>

        {/* Submit & Delete */}
        <div className="flex justify-between items-center gap-3">
          <div className="flex gap-3">
            <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
              {saving ? 'กำลังบันทึก…' : isEdit ? 'อัปเดตรายการเทรด' : 'บันทึกรายการเทรด'}
            </button>
            <button type="button" className="btn btn-secondary btn-lg" onClick={() => navigate(-1)}>
              ยกเลิก
            </button>
          </div>

          {isEdit && existingTrade && (existingTrade.user_id === user?.id) && (
            <button
              type="button"
              className="btn btn-danger btn-lg"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={saving || deleting}
            >
              🗑️ ลบรายการเทรด
            </button>
          )}
        </div>
      </form>

      {/* Lightbox Modal */}
      {lightboxUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <button
            type="button"
            className="lightbox-close-btn"
            onClick={() => setLightboxUrl(null)}
            aria-label="Close"
          >
            ✕ ปิด
          </button>
          <img
            src={lightboxUrl}
            alt="Expanded screenshot preview"
            className="lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && existingTrade && (
        <div className="modal-overlay" onClick={() => !deleting && setShowDeleteConfirm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title text-negative">ยืนยันการลบรายการเทรด</h2>
            <div style={{ marginBottom: 'var(--space-4)', lineHeight: '1.6', fontSize: 'var(--text-base)' }}>
              คุณแน่ใจหรือไม่ว่าต้องการลบรายการเทรด <strong>{existingTrade.asset}</strong> ({existingTrade.direction.toUpperCase()})?
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
                onClick={handleDeleteTrade}
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

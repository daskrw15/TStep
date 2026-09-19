import type { Emotion, TradeStatus, TradeResult } from '../types';

export const EMOTION_LABELS: Record<Emotion, string> = {
  calm: 'นิ่งสงบ / มีสติ',
  confident: 'มั่นใจ',
  nervous: 'ประหม่า / ลังเล',
  fear: 'กลัว',
  fomo: 'กลัวตกรถ (FOMO)',
  angry: 'หัวร้อน / โกรธ',
  tired: 'เหนื่อยล้า',
  excited: 'ตื่นเต้น',
};

export const STATUS_LABELS: Record<TradeStatus, string> = {
  waiting: 'กำลังรอ',
  open: 'เปิดสถานะ',
  closed: 'ปิดแล้ว',
};

export const RESULT_LABELS: Record<TradeResult, string> = {
  none: 'ยังไม่มีผล',
  tp: 'TP',
  sl: 'SL',
  be: 'BE',
};

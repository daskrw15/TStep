import { useState, useEffect } from 'react';
import { fetchExchangeRates, DEFAULT_USD_THB_RATE, DEFAULT_THB_TO_USD_RATE, type ExchangeRates } from '../utils/trading';

export interface UseExchangeRateResult {
  usdToThb: number; // e.g. 35.5
  thbToUsd: number; // e.g. 0.028
  loading: boolean;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
}

/**
 * Shared React hook for live THB ↔ USD exchange rates.
 * Employs cached in-memory rates with automatic background fetching
 * and graceful fallback to DEFAULT_USD_THB_RATE.
 */
export function useExchangeRate(): UseExchangeRateResult {
  const [rates, setRates] = useState<ExchangeRates>({
    thbToUsd: DEFAULT_THB_TO_USD_RATE,
    usdToThb: DEFAULT_USD_THB_RATE,
    lastUpdated: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);

  const loadRate = async () => {
    try {
      const live = await fetchExchangeRates();
      setRates(live);
    } catch {
      // Keep defaults
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRate();
  }, []);

  return {
    usdToThb: rates.usdToThb,
    thbToUsd: rates.thbToUsd,
    loading,
    lastUpdated: rates.lastUpdated ? new Date(rates.lastUpdated) : null,
    refresh: loadRate,
  };
}

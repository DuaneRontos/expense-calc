import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiError } from '../api/problem';
import type { CategoryBreakdown, PeriodComparison, SpendOverTime, TimeBucket } from '../api/types';
import type { Period } from './periods';

/**
 * The three reports of spec §7 for one period (issue #16).
 *
 * **Fetched together and stored as one value.** All three describe the same
 * window, so a partial update would put two charts on screen describing
 * different periods — which is the kind of wrong that looks plausible.
 *
 * **Every field here is referentially stable between fetches.** The charts
 * memoize their geometry on the identity of the `buckets` array, so rebuilding
 * that array on each render would rebuild every SVG path and re-animate on any
 * unrelated parent update. Nothing in this hook maps, filters or spreads a
 * bucket list: the arrays handed to the charts are the ones `JSON.parse`
 * produced, unchanged.
 */
export interface Reports {
  breakdown: CategoryBreakdown | null;
  overTime: SpendOverTime | null;
  comparison: PeriodComparison | null;
  loading: boolean;
  error: ApiError | Error | null;
  retry: () => void;
}

export function useReports(period: Period, bucket: TimeBucket = 'MONTH'): Reports {
  const [state, setState] = useState<{
    breakdown: CategoryBreakdown | null;
    overTime: SpendOverTime | null;
    comparison: PeriodComparison | null;
  }>({ breakdown: null, overTime: null, comparison: null });

  /**
   * The failure on screen, paired with the window that produced it.
   *
   * Paired for the same reason `loading` is derived below: a failure belongs to
   * a particular window. Held as a bare value it outlives the request that
   * caused it, so switching presets after a failure leaves the old period's
   * error card sitting above the new period's load, blaming a window it does
   * not describe.
   */
  const [failure, setFailure] = useState<{ key: string; error: ApiError | Error } | null>(null);

  /**
   * Which period the reports on screen describe.
   *
   * `loading` is derived from this rather than stored, so nothing writes a
   * pending flag from inside an effect — the charts are stale exactly when they
   * came from a different window than the one being asked for.
   */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  /** Discards a response for a period the user has already moved off. */
  const generation = useRef(0);

  const key = `${period.from}|${period.to}|${bucket}`;
  const loading = loadedKey !== key;
  const error = failure?.key === key ? failure.error : null;

  const load = useCallback(async () => {
    const mine = ++generation.current;

    try {
      // In parallel: three independent reads of the same window, and the screen
      // has nothing useful to show until all three arrive.
      const [breakdown, overTime, comparison] = await Promise.all([
        api.byCategory(period),
        api.overTime(period, bucket),
        api.compare(period),
      ]);

      if (mine !== generation.current) {
        return;
      }
      setState({ breakdown, overTime, comparison });
      setFailure(null);
    } catch (caught) {
      if (mine !== generation.current) {
        return;
      }
      setFailure({ key, error: caught instanceof Error ? caught : new Error(String(caught)) });
    } finally {
      if (mine === generation.current) {
        // Marks the charts as describing this window, which clears `loading`.
        // Set on failure too: an error is a settled answer, not a request still
        // in flight.
        setLoadedKey(key);
      }
    }
    // `key` rather than `period`: callers build the object inline from a preset,
    // so a reference dependency would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    // Every state write in `load` happens after the responses arrive; the rule
    // cannot see through the await. `loading` is derived precisely so nothing
    // has to be written here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /**
   * Re-runs the current window's fetch.
   *
   * Clearing `loadedKey` is what makes the attempt visible: `loading` derives
   * from it, so the screen can say a request is in flight rather than
   * re-rendering the identical error card and inviting a second tap. The
   * failure itself stays up until this one settles — replacing it with a blank
   * panel would answer a tap with less on screen than before it.
   */
  const retry = useCallback(() => {
    setLoadedKey(null);
    void load();
  }, [load]);

  // Memoized so the object handed to the screen — and through it the bucket
  // arrays handed to the charts — keeps one identity between fetches.
  return useMemo(
    () => ({ ...state, loading, error, retry }),
    [state, loading, error, retry],
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api/client';
import { useSignedIn } from '../api/useSignedIn';
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

  /**
   * Nothing is fetched without a session (#102).
   *
   * `unstable_settings.anchor` seeds the Overview beneath any deep-linked
   * child, `/sign-in` included — so landing there mounts this hook invisibly
   * and it fired three requests that could only 401. `AuthGuard` cannot prevent
   * that from where it sits: it has to exempt `/sign-in` or it redirects its own
   * escape hatch, and exempting means rendering the whole navigator, anchor and
   * all.
   *
   * Gated here rather than by moving the auth route out of the anchored stack,
   * because "do not fetch without a session" holds for every caller and every
   * future one, while restructuring the routes fixes only this instance. It
   * also covers signing out with the Overview open, which would otherwise
   * refetch into a 401 on the way to the sign-in screen.
   *
   * `useSignedIn` rather than `useAuthGate`: this needs the answer, not the
   * resolution, and `useAuthGate` would run a second `api.resume()` per
   * consumer for a question the session store already answers with no side
   * effect. `loading` stays true meanwhile, which is what the screen should
   * show — the reports are not absent, they are not yet askable.
   */
  const signedIn = useSignedIn();

  useEffect(() => {
    if (!signedIn) {
      return;
    }
    // Every state write in `load` happens after the responses arrive; the rule
    // cannot see through the await. `loading` is derived precisely so nothing
    // has to be written here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, signedIn]);

  /**
   * Re-runs the current window's fetch.
   *
   * Clearing `loadedKey` is what makes the attempt visible: `loading` derives
   * from it, so the screen can say a request is in flight rather than
   * re-rendering the identical error card and inviting a second tap. The
   * failure itself stays up until this one settles — replacing it with a blank
   * panel would answer a tap with less on screen than before it.
   */
  /**
   * Gated for the same reason the effect above is, and it was not at first.
   *
   * Putting the guard only on the mount path left this open: a session can end
   * while the failure card is on screen — a refresh rejected with 401 clears it
   * — and **Try again** then fired three unauthenticated requests, which is the
   * class this hook now exists to prevent. The invariant is "this hook does not
   * fetch without a session", not "it does not fetch on mount without one".
   */
  const retry = useCallback(() => {
    if (!signedIn) {
      return;
    }
    setLoadedKey(null);
    void load();
  }, [load, signedIn]);

  // Memoized so the object handed to the screen — and through it the bucket
  // arrays handed to the charts — keeps one identity between fetches.
  return useMemo(
    () => ({ ...state, loading, error, retry }),
    [state, loading, error, retry],
  );
}

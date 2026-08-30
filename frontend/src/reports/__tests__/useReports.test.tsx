import { act, renderHook, waitFor } from '@testing-library/react-native';

import { api } from '../../api/client';
import { ApiError } from '../../api/problem';
import { useReports } from '../useReports';
import type { CategoryBreakdown, PeriodComparison, SpendOverTime } from '../../api/types';
import type { Period } from '../periods';

const AUGUST: Period = { from: '2026-08-01', to: '2026-09-01' };
const JULY: Period = { from: '2026-07-01', to: '2026-08-01' };

const breakdown = (total: string): CategoryBreakdown => ({
  period: AUGUST,
  currency: 'PHP',
  total,
  buckets: [{ key: 'GROCERIES', label: 'Groceries', total }],
});

const overTime = (): SpendOverTime => ({
  period: AUGUST,
  bucket: 'DAY',
  currency: 'PHP',
  total: '0.00',
  buckets: [],
});

const comparison = (): PeriodComparison => ({
  current: AUGUST,
  previous: JULY,
  currency: 'PHP',
  currentTotal: '0.00',
  previousTotal: '0.00',
  buckets: [],
});

/** A promise the test releases by hand, to hold a request visibly in flight. */
function gate() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

/** Resolves all three reports with `total`, optionally not until `held` settles. */
function stubSuccess(total: string, held: Promise<void> = Promise.resolve()) {
  jest.spyOn(api, 'byCategory').mockImplementation(() => held.then(() => breakdown(total)));
  jest.spyOn(api, 'overTime').mockImplementation(() => held.then(overTime));
  jest.spyOn(api, 'compare').mockImplementation(() => held.then(comparison));
}

function stubFailure(error: Error, held: Promise<void> = Promise.resolve()) {
  const fail = () => held.then<never>(() => Promise.reject(error));
  jest.spyOn(api, 'byCategory').mockImplementation(fail);
  jest.spyOn(api, 'overTime').mockImplementation(fail);
  jest.spyOn(api, 'compare').mockImplementation(fail);
}

const forPeriod = (period: Period) => ({ period });

// Web-shaped tokens, so the refresh-token store is never touched.
const signIn = () => act(async () => {
  await api.session.adopt({ accessToken: 'access-1', expiresInSeconds: 900 }, true);
});

beforeEach(async () => {
  // These reports need a session now (#102), so every test starts with one
  // except the two below that are about its absence.
  await api.session.clear();
  await signIn();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await act(async () => {
    await api.session.clear();
  });
});

describe('useReports', () => {
  /**
   * Landing directly on `/sign-in` mounts the Overview beneath it (#102).
   *
   * `unstable_settings.anchor` seeds `index` under any deep-linked child so the
   * hardware back button does not exit the app from what reads as a peer tab.
   * The guard cannot undo that from where it sits — it exempts `/sign-in`, and
   * exempting means rendering the whole navigator, anchor included. So the
   * Overview mounts invisibly and fires three requests that can only 401.
   *
   * Fixed here rather than by restructuring the routes, because "do not fetch
   * without a session" is true of every caller and every future one, while
   * moving the auth route fixes only this instance of it. It also covers
   * signing out while the Overview is open, which would otherwise refetch into
   * a 401 on the way to the sign-in screen.
   */
  it('fetches nothing without a session', async () => {
    stubSuccess('100.00');
    await act(async () => {
      await api.session.clear();
    });

    const { result } = await renderHook(({ period }: { period: Period }) => useReports(period), {
      initialProps: forPeriod(AUGUST),
    });

    expect(api.byCategory).not.toHaveBeenCalled();
    expect(api.overTime).not.toHaveBeenCalled();
    expect(api.compare).not.toHaveBeenCalled();
    // Anchored on a real outcome: the hook rendered and is holding, rather than
    // having quietly resolved to an empty state that would satisfy the three
    // absences above just as well.
    expect(result.current.loading).toBe(true);
    expect(result.current.breakdown).toBeNull();
  });

  /**
   * `retry()` is gated too, not only the mount effect.
   *
   * The gate went on the effect first and left this open: `retry` calls `load()`
   * directly, so the invariant held for the mount path and nothing else. The
   * reachable case is a session ending while the failure card is on screen — a
   * refresh rejected with 401 clears the session — and then a press of **Try
   * again** firing three unauthenticated requests, which is the class this whole
   * change exists to stop.
   */
  it('retries nothing once the session has gone', async () => {
    stubFailure(new Error('down'));

    const { result } = await renderHook(({ period }: { period: Period }) => useReports(period), {
      initialProps: forPeriod(AUGUST),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    const before = (api.byCategory as jest.Mock).mock.calls.length;
    expect(before).toBeGreaterThan(0);

    await act(async () => {
      await api.session.clear();
    });
    await act(async () => {
      result.current.retry();
    });

    expect((api.byCategory as jest.Mock).mock.calls.length).toBe(before);
  });

  it('fetches as soon as a session arrives', async () => {
    stubSuccess('100.00');
    await act(async () => {
      await api.session.clear();
    });

    const { result } = await renderHook(({ period }: { period: Period }) => useReports(period), {
      initialProps: forPeriod(AUGUST),
    });
    expect(api.byCategory).not.toHaveBeenCalled();

    await signIn();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.breakdown?.total).toBe('100.00');
  });

  it('stops loading once the window it was asked for has arrived', async () => {
    stubSuccess('100.00');
    const { result } = await renderHook(({ period }: { period: Period }) => useReports(period), {
      initialProps: forPeriod(AUGUST),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.breakdown?.total).toBe('100.00');
    expect(result.current.error).toBeNull();
  });

  it('settles the load on failure rather than leaving a request in flight', async () => {
    // An error is an answer, not a request still running. Leaving `loading`
    // true would spin behind the error card forever, and a retry could never be
    // told apart from the attempt that failed.
    stubFailure(new Error('offline'));
    const { result } = await renderHook(({ period }: { period: Period }) => useReports(period), {
      initialProps: forPeriod(AUGUST),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.loading).toBe(false);
  });

  it('makes a retry visible for as long as it runs', async () => {
    // The whole point. Without this the screen re-renders the byte-identical
    // error card, so the tap appears to do nothing — and the natural response
    // to that is to tap again and fan out another three requests.
    stubFailure(new ApiError({ status: 503, title: 'Service Unavailable' }));
    const { result } = await renderHook(({ period }: { period: Period }) => useReports(period), {
      initialProps: forPeriod(AUGUST),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    const second = gate();
    stubFailure(new ApiError({ status: 503, title: 'Service Unavailable' }), second.held);

    await act(() => {
      result.current.retry();
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      second.release();
      await second.held;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Still failing, so the card stays put — but the attempt was observable.
    expect(result.current.error).not.toBeNull();
  });

  it('clears the error when a retry succeeds', async () => {
    stubFailure(new Error('offline'));
    const { result } = await renderHook(({ period }: { period: Period }) => useReports(period), {
      initialProps: forPeriod(AUGUST),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    stubSuccess('250.00');
    await act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.breakdown?.total).toBe('250.00');
  });

  it('does not attribute one window’s failure to the next', async () => {
    // Switching presets after a failure used to leave the old period's error
    // card above the new period's load, blaming a window it never described.
    stubFailure(new Error('offline'));
    const { result, rerender } = await renderHook(
      ({ period }: { period: Period }) => useReports(period),
      { initialProps: forPeriod(AUGUST) },
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());

    const next = gate();
    stubSuccess('40.00', next.held);
    await rerender(forPeriod(JULY));

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);

    next.release();
    await waitFor(() => expect(result.current.breakdown?.total).toBe('40.00'));
  });

  it('discards a response for a period the user has already moved off', async () => {
    // The generation guard. Without it the slow first response lands last and
    // overwrites the window on screen with one nobody is looking at.
    const slow = gate();
    stubSuccess('999.00', slow.held);

    const { result, rerender } = await renderHook(
      ({ period }: { period: Period }) => useReports(period),
      { initialProps: forPeriod(AUGUST) },
    );

    stubSuccess('40.00');
    await rerender(forPeriod(JULY));
    await waitFor(() => expect(result.current.breakdown?.total).toBe('40.00'));

    await act(async () => {
      slow.release();
      await slow.held;
    });

    expect(result.current.breakdown?.total).toBe('40.00');
  });

  it('hands the charts the very array the response arrived with', async () => {
    // The charts memoize their geometry on this identity. Mapping or spreading
    // the buckets here would rebuild every SVG path on any unrelated render.
    const response = breakdown('100.00');
    jest.spyOn(api, 'byCategory').mockResolvedValue(response);
    jest.spyOn(api, 'overTime').mockResolvedValue(overTime());
    jest.spyOn(api, 'compare').mockResolvedValue(comparison());

    const { result, rerender } = await renderHook(
      ({ period }: { period: Period }) => useReports(period),
      { initialProps: forPeriod(AUGUST) },
    );
    await waitFor(() => expect(result.current.breakdown).not.toBeNull());

    const first = result.current.breakdown!.buckets;
    expect(first).toBe(response.buckets);

    // A new `period` object describing the same window must not refetch, and
    // must not hand the charts a different array.
    await rerender(forPeriod({ ...AUGUST }));
    expect(result.current.breakdown!.buckets).toBe(first);
    expect(api.byCategory).toHaveBeenCalledTimes(1);
  });
});

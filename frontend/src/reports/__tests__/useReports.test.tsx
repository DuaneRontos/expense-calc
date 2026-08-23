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

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useReports', () => {
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

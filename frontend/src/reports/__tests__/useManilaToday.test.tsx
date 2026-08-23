import { act, renderHook } from '@testing-library/react-native';

import { useManilaToday } from '../useManilaToday';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useManilaToday', () => {
  it('reads the date in Manila, not in UTC', async () => {
    // 17:00 UTC on 31 January is already 1 February in Manila.
    jest.setSystemTime(Date.parse('2026-01-31T17:00:00Z'));
    const { result } = await renderHook(() => useManilaToday());

    expect(result.current).toBe('2026-02-01');
  });

  it('moves the window on when Manila crosses midnight', async () => {
    // The bug this exists for: nothing re-renders at the boundary, so a tab
    // left open overnight keeps asking for yesterday — and on the 31st that
    // means "This month" is still reporting last month.
    jest.setSystemTime(Date.parse('2026-08-23T15:59:00Z'));
    const { result } = await renderHook(() => useManilaToday());
    expect(result.current).toBe('2026-08-23');

    await act(async () => {
      jest.advanceTimersByTime(61_000);
    });

    expect(result.current).toBe('2026-08-24');
  });

  it('re-arms itself, so the second midnight lands too', async () => {
    // A timer that only fires once would leave the date stuck a day later
    // instead of a day earlier, which is no better.
    jest.setSystemTime(Date.parse('2026-08-23T15:59:00Z'));
    const { result } = await renderHook(() => useManilaToday());

    await act(async () => {
      jest.advanceTimersByTime(61_000);
    });
    await act(async () => {
      jest.advanceTimersByTime(86_400_000);
    });

    expect(result.current).toBe('2026-08-25');
  });
});

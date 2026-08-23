import { act, renderHook } from '@testing-library/react-native';

import { useDelayedFlag } from '../useDelayedFlag';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useDelayedFlag', () => {
  it('stays down while the wait is still short', async () => {
    // A spinner that shows and hides inside 80ms reads as a glitch rather than
    // as progress, and against a local API most reports return that fast.
    const { result } = await renderHook(({ value }: { value: boolean }) => useDelayedFlag(value), {
      initialProps: { value: true },
    });

    expect(result.current).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(result.current).toBe(false);
  });

  it('comes up once the wait is long enough to be worth mentioning', async () => {
    const { result } = await renderHook(({ value }: { value: boolean }) => useDelayedFlag(value), {
      initialProps: { value: true },
    });

    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(result.current).toBe(true);
  });

  it('drops the moment the value does, so nothing lingers after the data', async () => {
    const { result, rerender } = await renderHook(
      ({ value }: { value: boolean }) => useDelayedFlag(value),
      { initialProps: { value: true } },
    );

    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(result.current).toBe(true);

    await rerender({ value: false });
    expect(result.current).toBe(false);
  });

  it('does not carry a previous wait into the next one', async () => {
    // The flag is derived, so a stale `elapsed` from an earlier load would show
    // the spinner instantly on the next period change.
    const { result, rerender } = await renderHook(
      ({ value }: { value: boolean }) => useDelayedFlag(value),
      { initialProps: { value: true } },
    );

    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    await rerender({ value: false });
    await rerender({ value: true });

    expect(result.current).toBe(false);
  });
});

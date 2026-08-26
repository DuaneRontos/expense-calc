import { act, renderHook } from '@testing-library/react-native';

import { api } from '../client';
import { useSignedIn } from '../useSignedIn';

/**
 * The reactive half of sign-out.
 *
 * `Session` knows whether a session exists and now says when that changes;
 * this hook is what lets a component re-render on it. Without it the shell
 * would read the answer once at mount and keep showing it — a Sign out button
 * that never appears after signing in, or never leaves after signing out.
 *
 * `viaCookie: true` on every `adopt` here so the refresh-token store is never
 * touched: that path sets the access token and returns, which is exactly the
 * transition under test and nothing else.
 */
// Web-shaped: no `refreshToken` in the body at all, because the server put it
// in an httpOnly cookie (issue #57). Matches what `viaCookie: true` means.
const TOKENS = { accessToken: 'access-1', expiresInSeconds: 900 };

describe('useSignedIn', () => {
  beforeEach(async () => {
    await api.session.clear();
  });

  it('is false before anything is adopted', async () => {
    const { result } = await renderHook(() => useSignedIn());

    expect(result.current).toBe(false);
  });

  it('turns true when a session is adopted', async () => {
    const { result } = await renderHook(() => useSignedIn());

    await act(async () => {
      await api.session.adopt(TOKENS, true);
    });

    expect(result.current).toBe(true);
  });

  it('turns false again when the session is cleared', async () => {
    const { result } = await renderHook(() => useSignedIn());

    await act(async () => {
      await api.session.adopt(TOKENS, true);
    });
    expect(result.current).toBe(true);

    await act(async () => {
      await api.session.clear();
    });

    expect(result.current).toBe(false);
  });

  /**
   * Two mounted readers both see the change.
   *
   * A `Set` of listeners rather than a single slot is what makes that true, and
   * a single-slot implementation would pass every test above — only the second
   * subscriber reveals it.
   */
  it('updates every mounted reader', async () => {
    const first = await renderHook(() => useSignedIn());
    const second = await renderHook(() => useSignedIn());

    await act(async () => {
      await api.session.adopt(TOKENS, true);
    });

    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);
  });

  /**
   * Unmounting has to remove the listener, or every mount leaks one and a
   * later transition notifies a component React has thrown away.
   *
   * **The flush after `unmount()` is load-bearing.** React queues the
   * `useSyncExternalStore` cleanup rather than running it inline, so reading the
   * count immediately after still sees the listener and the test fails against a
   * perfectly correct implementation — which is exactly what happened while
   * writing this. The `act` is what makes the assertion measure the teardown
   * instead of the moment before it.
   */
  it('stops listening once unmounted', async () => {
    const { unmount } = await renderHook(() => useSignedIn());
    const before = api.session.listenerCount();
    expect(before).toBe(1);

    unmount();
    await act(async () => {});

    expect(api.session.listenerCount()).toBe(0);
  });
});

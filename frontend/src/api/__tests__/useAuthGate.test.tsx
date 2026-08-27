import { act, renderHook, waitFor } from '@testing-library/react-native';

import { api } from '../client';
import { useAuthGate } from '../useAuthGate';

/** What the server returns to a web client: the refresh token is in the cookie. */
const WEB_TOKENS = { accessToken: 'access-1', expiresInSeconds: 900 };

afterEach(async () => {
  jest.restoreAllMocks();
  // The session is a module singleton, so it outlives the test that signed it
  // in. Cleared here rather than in each test, because a leaked session makes
  // the *next* test pass for the wrong reason.
  await api.session.clear();
});

describe('useAuthGate', () => {
  it('reports resolving until the client has settled the question', async () => {
    // **The third state is what keeps a returning visitor off the sign-in
    // screen.** On web the credential is an `httpOnly` cookie no script can
    // read, so at first paint "signed out" and "not asked yet" look identical.
    // A guard with only a boolean redirects on that first false and bounces
    // everyone who was already signed in.
    let settle!: () => void;
    jest.spyOn(api, 'resume').mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          settle = async () => {
            await api.session.adopt(WEB_TOKENS, true);
            resolve(true);
          };
        }),
    );

    // Awaited, like `render`: this renderer is async, and an un-awaited
    // `renderHook` hands back a promise whose `result` is undefined.
    const { result } = await renderHook(() => useAuthGate());

    expect(result.current).toBe('resolving');

    await act(async () => {
      settle();
    });
    await waitFor(() => expect(result.current).toBe('signed-in'));
  });

  it('reports signed-out once the client says there is no session', async () => {
    jest.spyOn(api, 'resume').mockResolvedValue(false);

    // Awaited, like `render`: this renderer is async, and an un-awaited
    // `renderHook` hands back a promise whose `result` is undefined.
    const { result } = await renderHook(() => useAuthGate());

    await waitFor(() => expect(result.current).toBe('signed-out'));
  });

  it('settles a second consumer too, not only the one that asked first', async () => {
    // The guard sits in the root layout, but nothing stops a screen reading the
    // same hook. Both must arrive at an answer — and neither may rotate the
    // refresh token twice, which `refresh()`'s single-flight guard is what
    // actually prevents.
    jest.spyOn(api, 'resume').mockImplementation(async () => {
      await api.session.adopt(WEB_TOKENS, true);
      return true;
    });

    const first = await renderHook(() => useAuthGate());
    const second = await renderHook(() => useAuthGate());

    await waitFor(() => expect(first.result.current).toBe('signed-in'));
    await waitFor(() => expect(second.result.current).toBe('signed-in'));
  });

  it('follows the session out when it ends', async () => {
    // Signing out clears the session from outside React. A gate that read
    // `resume()` once and stopped would keep reporting a session that no longer
    // exists, and the guard would never act on the sign-out.
    jest.spyOn(api, 'resume').mockImplementation(async () => {
      await api.session.adopt(WEB_TOKENS, true);
      return true;
    });

    // Awaited, like `render`: this renderer is async, and an un-awaited
    // `renderHook` hands back a promise whose `result` is undefined.
    const { result } = await renderHook(() => useAuthGate());
    await waitFor(() => expect(result.current).toBe('signed-in'));

    await act(async () => {
      await api.session.clear();
    });

    await waitFor(() => expect(result.current).toBe('signed-out'));
  });
});

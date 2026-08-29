import { Stack } from 'expo-router';
import { useEffect, useReducer } from 'react';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { AuthGuard } from '../AuthGuard';
import type { AuthGate } from '../../api/useAuthGate';

/**
 * The half `authGuard.test.tsx` cannot cover.
 *
 * That suite mocks `expo-router` wholesale and replaces `Redirect` with a
 * marker, which proves the guard *asked* to navigate and nothing more. Whether a
 * `Redirect` rendered from a root layout — in place of the navigator, rather
 * than from inside a screen — actually lands is a different claim, and it is the
 * one worth pinning: `Redirect` hands an un-memoized arrow to `useFocusEffect`,
 * so its effect re-runs on every render and fires `router.replace` again. Inside
 * a screen that is harmless, because the screen unmounts. Inside a layout that
 * outlives the navigation it is the shape of an update loop.
 */
const mockGateListeners = new Set<() => void>();
const mockGate = {
  value: 'resolving' as AuthGate,
  get current(): AuthGate {
    return this.value;
  },
  // Reactive, so a test can end the session *after* mount — the transition the
  // cold-load cases below cannot reach, and the one that broke in a browser.
  set current(next: AuthGate) {
    this.value = next;
    mockGateListeners.forEach((notify) => notify());
  },
};

// `mock`-prefixed so the hoisted factory below may reference them; a bare
// `require('react')` inside it works but trips `no-require-imports`.
const mockUseReducer = useReducer;
const mockUseEffect = useEffect;

jest.mock('../../api/useAuthGate', () => ({
  useAuthGate: () => {
    const [, bump] = mockUseReducer((n: number) => n + 1, 0);
    mockUseEffect(() => {
      mockGateListeners.add(bump);
      return () => {
        mockGateListeners.delete(bump);
      };
    }, []);
    return mockGate.current;
  },
}));

function routes() {
  return {
    _layout: () => (
      <AuthGuard>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthGuard>
    ),
    index: () => <Text>overview</Text>,
    'sign-in': () => <Text>the form</Text>,
    expenses: () => <Text>the list</Text>,
  };
}

describe('the guard, driven through the real router', () => {
  // `spyOn` hands back the *existing* mock when the property is already
  // spied, and nothing in the jest config restores between tests — so without
  // this, every `not.toHaveBeenCalled()` below is asserted against a spy
  // carrying the previous tests' history. It only ever makes them stricter,
  // but one failure would then fail all of them and point at the wrong test.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lands a signed-out cold load on the sign-in screen', async () => {
    // `Redirect` swallows a failed `replace` into `console.error`, so without
    // watching it a silent failure to navigate is indistinguishable from a slow
    // one — and a re-render loop reports itself the same way.
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGate.current = 'signed-out';

    await renderRouter(routes(), { initialUrl: '/expenses' });

    expect(await screen.findByText('the form')).toBeOnTheScreen();
    expect(errors).not.toHaveBeenCalled();
  });

  it('renders the app when the session resolves the other way', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGate.current = 'signed-in';

    await renderRouter(routes(), { initialUrl: '/expenses' });

    expect(await screen.findByText('the list')).toBeOnTheScreen();
    expect(errors).not.toHaveBeenCalled();
  });

  /**
   * The session ending while the app is already up — signing out, or a refresh
   * that comes back rejected. Not reachable by the cold-load cases above.
   *
   * **This does not reproduce the bug it was written for, and saying so is the
   * point.** In a browser, returning a `Redirect` here unmounted the navigator
   * that every form of expo-router navigation needs, leaving a blank screen on
   * `/` with the URL unchanged; with `SignOutButton` also calling
   * `router.replace`, the two collided into `Maximum update depth exceeded` at
   * `ContextNavigator`. Checked against the previous implementation, this test
   * passes there too — `renderRouter`'s harness resolves the redirect where the
   * real web navigator does not.
   *
   * It is kept because the transition is worth asserting on its own terms, not
   * because it guards that regression. **The guard for that lives in
   * `authGuard.test.tsx`**, which mocks `expo-router` wholesale and can assert
   * on which navigation primitive was reached for — the axis the two
   * implementations actually differ on, and one this file cannot see because
   * it drives the real router and both eventually arrive.
   */
  it('lands on the sign-in screen when the session ends after mount', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGate.current = 'signed-in';

    await renderRouter(routes(), { initialUrl: '/expenses' });
    expect(await screen.findByText('the list')).toBeOnTheScreen();

    await act(async () => {
      mockGate.current = 'signed-out';
    });

    expect(await screen.findByText('the form')).toBeOnTheScreen();
    expect(errors).not.toHaveBeenCalled();
  });

  it('does not navigate while the session is still in question', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGate.current = 'resolving';

    await renderRouter(routes(), { initialUrl: '/expenses' });

    // Anchored on the spinner, so the absence below sits in a tree that exists.
    expect(await screen.findByLabelText('Checking your session')).toBeOnTheScreen();
    expect(screen.queryByText('the form')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});

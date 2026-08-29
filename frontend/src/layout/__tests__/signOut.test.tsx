import { act, render, screen, userEvent } from '@testing-library/react-native';

import { AppShell } from '../AppShell';
import { BREAKPOINTS, type LayoutSize } from '../breakpoints';
import { api } from '../../api/client';
import { ExpenseQueryProvider } from '../../expenses/ExpenseQueryProvider';

/**
 * Sign-out (the counterpart to the sign-in screen #86 added).
 *
 * `client.logout()` has existed and been tested since #57 and nothing called
 * it — the same shape `login()` was in before #86. This is the control that
 * calls it.
 *
 * **It is conditional, and that is the whole design.** Under the
 * `insecure-local` profile no session is ever adopted, so an unconditional
 * "Sign out" would sit in the chrome of an app you were never signed in to and
 * do nothing you could observe. `useSignedIn()` is what makes the condition
 * reactive rather than a snapshot taken at mount.
 */
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  usePathname: () => '/expenses',
  router: {
    navigate: () => {},
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../expenses/useCategories', () => ({
  useCategories: () => ({ categories: [], loading: false, error: null, retry: () => {} }),
}));

// `mock`-prefixed so the hoisted factory above may reference it.
let mockWidth = BREAKPOINTS.compact + 1;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 900, scale: 2, fontScale: 1 }),
}));

const BANDS: { size: LayoutSize; width: number }[] = [
  { size: 'compact', width: BREAKPOINTS.compact - 1 },
  { size: 'medium', width: BREAKPOINTS.compact + 1 },
  { size: 'expanded', width: BREAKPOINTS.expanded + 1 },
];

// Web-shaped: no `refreshToken` in the body at all, because the server put it
// in an httpOnly cookie (issue #57). Matches what `viaCookie: true` means.
const TOKENS = { accessToken: 'access-1', expiresInSeconds: 900 };

// Rendered inside the provider because the expanded band mounts
// `ExpenseFilters`, and `useExpenseQuery` throws outside one.
const renderShell = () =>
  render(
    <ExpenseQueryProvider>
      <AppShell>
        <></>
      </AppShell>
    </ExpenseQueryProvider>,
  );

/** `viaCookie` so the refresh-token store is never touched — see useSignedIn.test.ts. */
const signIn = () => act(async () => {
  await api.session.adopt(TOKENS, true);
});

/**
 * Wrapped, because RNTL registers its auto-cleanup at the root level and Jest
 * runs an inner `afterEach` *first* — so the tree is still mounted and clearing
 * the session notifies a live subscriber outside `act`. Warnings that all pass
 * are how a real one becomes invisible.
 */
const resetSession = () => act(async () => {
  await api.session.clear();
});

/**
 * Only the visibility rule is banded.
 *
 * `SignOutButton` sits in the header row, which every band renders — so all
 * three exercise an identical subtree, and banding the behaviour below would
 * assert the same thing three times. What banding is worth here is catching
 * someone moving the control into a band-conditional branch, where it would
 * quietly vanish on one or two of the three targets. That is a visibility
 * question, so it lives here and the rest does not.
 */
describe.each(BANDS)('Sign out visibility ($size)', (band) => {
  beforeEach(async () => {
    mockWidth = band.width;
    mockReplace.mockClear();
    await api.session.clear();
  });

  afterEach(resetSession);

  /**
   * The absence is asserted inside a tree known to have rendered. Anchored on
   * the header *by role*, not by text: `usePathname` is mocked to `/expenses`,
   * so the title and a nav label share the string, and `getByText` resolves to
   * one match only because the nav happens to be gated. Weaken that gate and
   * this suite fails with a message about sign-out for a reason that has
   * nothing to do with sign-out.
   */
  it('offers no way to sign out when there is no session', async () => {
    await renderShell();

    expect(screen.getByRole('header', { name: 'Expenses' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('offers sign out once a session exists', async () => {
    await renderShell();
    await signIn();

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
  });
});

describe('Sign out behaviour', () => {
  beforeEach(async () => {
    // One band, since none of this is band-dependent — see the note above.
    mockWidth = BREAKPOINTS.compact + 1;
    mockReplace.mockClear();
    await api.session.clear();
  });

  afterEach(resetSession);

  /**
   * **Calls `logout()` and navigates nowhere.**
   *
   * Deliberately not "ends the session": `logout` is stubbed here, so nothing
   * clears anything. The test below is the one that observes the session
   * actually ending.
   *
   * `AuthGuard` owns where a signed-out visitor goes — it sits above the
   * navigator and swaps the whole subtree for a `Redirect` the moment the
   * session clears. This button navigating as well raced that redirect, and
   * expo-router's `ContextNavigator` resolved the collision by looping:
   *
   *     Uncaught  Maximum update depth exceeded
   *       at ContextNavigator
   *     An error occurred in the <Content> component.
   *
   * which leaves a blank screen. Reproduced in a browser against a real
   * backend; the two navigations land in either order and only one of those
   * orders survives, which is why it presents as intermittent.
   */
  it('calls logout without navigating, leaving that to the guard', async () => {
    const logout = jest
      .spyOn(api, 'logout')
      .mockResolvedValue({ revokedSessions: 1, note: 'Signed out everywhere.' });

    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    logout.mockRestore();
  });

  /**
   * `logout()` clears local state in a `finally`, so the session is gone even
   * when the network call failed — and the guard follows the session rather
   * than the call's outcome. A `null` return is exactly that case: the request
   * failed for a reason the client could not narrow, and the visitor is still
   * signed out locally.
   */
  it('still ends the session when the server call fails', async () => {
    const logout = jest.spyOn(api, 'logout').mockImplementation(async () => {
      await api.session.clear();
      return null;
    });

    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    // Positive first, so the absence below is asserted against a real outcome
    // rather than against a render that did nothing.
    expect(api.session.isSignedIn()).toBe(false);
    expect(mockReplace).not.toHaveBeenCalled();

    logout.mockRestore();
  });

  /**
   * Signing out and back in leaves a usable control.
   *
   * **The other tests here cannot catch this**, which is why it mocks `logout`
   * differently: they stub it wholesale, so `session.clear()` never runs,
   * `signedIn` stays true and the button stays mounted and visible. Only a mock
   * that performs the real side effect reaches the state where the component
   * re-renders as `null` — which does *not* discard its `useState`, because
   * `AppShell` wraps the whole `Stack` including `sign-in`, so navigating there
   * never unmounts it.
   *
   * Before the fix this found a permanently disabled "Signing out…" that no
   * further press could clear.
   */
  it('is pressable again after signing out and back in', async () => {
    const logout = jest.spyOn(api, 'logout').mockImplementation(async () => {
      await api.session.clear();
      return null;
    });

    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();

    await signIn();

    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeDisabled();

    logout.mockRestore();
  });

  /**
   * A second press while the first is in flight would revoke twice and race two
   * navigations. The label is the state, so it is also what a screen reader
   * hears — colour and a disabled prop alone would say nothing on web, where
   * RNW forwards no `accessibilityState` (issue #69).
   */
  it('says it is signing out while the request is in flight', async () => {
    let release: (value: null) => void = () => {};
    const logout = jest
      .spyOn(api, 'logout')
      .mockReturnValue(new Promise((resolve) => {
        release = resolve;
      }));

    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled();

    await act(async () => {
      release(null);
    });

    logout.mockRestore();
  });
});

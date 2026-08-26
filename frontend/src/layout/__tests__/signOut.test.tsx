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

describe.each(BANDS)('Sign out ($size)', (band) => {
  beforeEach(async () => {
    mockWidth = band.width;
    mockReplace.mockClear();
    await api.session.clear();
  });

  afterEach(async () => {
    await api.session.clear();
  });

  /**
   * The absence is asserted inside a tree known to have rendered — the header
   * title anchors it. `queryByText(...)).toBeNull()` alone is satisfied by a
   * render that mounted nothing at all.
   */
  it('offers no way to sign out when there is no session', async () => {
    await renderShell();

    expect(screen.getByLabelText('Expenses, current screen')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('offers sign out once a session exists', async () => {
    await renderShell();
    await signIn();

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
  });

  it('signs out and sends you to the sign-in screen', async () => {
    const logout = jest
      .spyOn(api, 'logout')
      .mockResolvedValue({ revokedSessions: 1, note: 'Signed out everywhere.' });

    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/sign-in');

    logout.mockRestore();
  });

  /**
   * `logout()` clears local state in a `finally`, so the session is gone even
   * when the network call failed — and the control has to follow that rather
   * than stranding someone on a screen that says they are still signed in.
   * A `null` return is exactly that case: the request failed for a reason the
   * client could not narrow.
   */
  it('leaves for the sign-in screen even when the server call fails', async () => {
    const logout = jest.spyOn(api, 'logout').mockResolvedValue(null);

    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    expect(mockReplace).toHaveBeenCalledWith('/sign-in');

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

import { act, render, screen } from '@testing-library/react-native';

import { AppShell } from '../AppShell';
import { BREAKPOINTS, type LayoutSize } from '../breakpoints';
import { api } from '../../api/client';
import { ExpenseQueryProvider } from '../../expenses/ExpenseQueryProvider';

/**
 * The nav is not offered without a session.
 *
 * `AuthGuard` keeps a signed-out visitor on `/sign-in`, but the shell around
 * that screen still drew Overview and Expenses. Pressing one navigated
 * unconditionally — `useNavItems` has no session check — so the protected
 * screen mounted and ran its effects before the guard's redirect landed. That
 * is the shape #92 exists to prevent, reached from the one route #92 has to
 * leave reachable.
 *
 * **Banded, because the nav renders from three mutually exclusive places** —
 * the medium header row, the expanded sidebar, the compact tab bar. A gate
 * applied to two of the three leaves the third offering a way in, and nothing
 * else in the suite would notice.
 */
jest.mock('expo-router', () => ({
  usePathname: () => '/sign-in',
  router: { navigate: () => {}, replace: () => {} },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../expenses/useCategories', () => ({
  useCategories: () => ({ categories: [], loading: false, error: null, retry: () => {} }),
}));

// `mock`-prefixed so the hoisted factory may reference it.
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

// Web-shaped: the refresh token is an httpOnly cookie, so the body carries none.
const TOKENS = { accessToken: 'access-1', expiresInSeconds: 900 };

const renderShell = () =>
  render(
    <ExpenseQueryProvider>
      <AppShell>
        <></>
      </AppShell>
    </ExpenseQueryProvider>,
  );

const signIn = () => act(async () => {
  await api.session.adopt(TOKENS, true);
});

const resetSession = () => act(async () => {
  await api.session.clear();
});

describe.each(BANDS)('Navigation without a session ($size)', (band) => {
  beforeEach(async () => {
    mockWidth = band.width;
    await api.session.clear();
  });

  afterEach(resetSession);

  /**
   * The absences are anchored on the header, which renders on every route with
   * or without a session — so this is an absence inside a tree that exists
   * rather than a render that mounted nothing.
   */
  it('offers no way into a protected route', async () => {
    await renderShell();

    expect(screen.getByText('Expense Calc')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Overview')).toBeNull();
    expect(screen.queryByLabelText('Expenses')).toBeNull();
  });

  it('offers the destinations once there is a session', async () => {
    await renderShell();
    await signIn();

    expect(screen.getByLabelText('Overview')).toBeOnTheScreen();
    expect(screen.getByLabelText('Expenses')).toBeOnTheScreen();
  });

  /**
   * The gate follows the session rather than sampling it at mount — the same
   * property `useSignedIn` exists for, and the reason signing out cannot leave
   * a live route behind in the chrome.
   */
  it('withdraws them again when the session ends', async () => {
    await renderShell();
    await signIn();
    expect(screen.getByLabelText('Expenses')).toBeOnTheScreen();

    await resetSession();

    expect(screen.getByText('Expense Calc')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Expenses')).toBeNull();
  });
});

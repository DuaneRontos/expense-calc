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
// `mock`-prefixed so the hoisted factory may read it.
const mockPath = { current: '/sign-in' };

jest.mock('expo-router', () => ({
  usePathname: () => mockPath.current,
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
    mockPath.current = '/sign-in';
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

    expect(screen.getByRole('header', { name: 'Expense Calc' })).toBeOnTheScreen();
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
   * **The chrome itself, not only its contents.**
   *
   * The stated reason for gating at the render sites rather than emptying
   * `nav` was that it also avoids drawing empty chrome — and label assertions
   * cannot see that. Signed out on `/sign-in` the expanded sidebar had both
   * children removed (the nav by session, the filters because sign-in is not a
   * destination) and still rendered: a 280px bordered column with nothing in
   * it, beside the sign-in form on any desktop window.
   *
   * The compact half of the same claim was already true; this pins both, so
   * the rationale stops being the part nothing checks.
   */
  it('draws no empty chrome where the destinations used to be', async () => {
    await renderShell();

    expect(screen.getByRole('header', { name: 'Expense Calc' })).toBeOnTheScreen();
    expect(screen.queryByTestId('nav-tab-bar')).toBeNull();
    expect(screen.queryByTestId('nav-sidebar')).toBeNull();
  });

  /**
   * **The sidebar can be present without the destinations.**
   *
   * Signed out on `/expenses` — the window between the session ending and the
   * guard's redirect landing — `filterable` is true, so the expanded sidebar
   * still has content worth showing. The container comes back; the nav must
   * not come with it.
   *
   * Without this the inner gate is unpinned: on `/sign-in` the container is
   * removed outright, so nothing ever reaches the branch that decides whether
   * the destinations belong inside it.
   */
  it('keeps the filters sidebar without the destinations', async () => {
    mockPath.current = '/expenses';

    await renderShell();

    if (band.size === 'expanded') {
      expect(screen.getByTestId('nav-sidebar')).toBeOnTheScreen();
    }
    expect(screen.queryByLabelText('Overview')).toBeNull();
    expect(screen.queryByLabelText('Expenses')).toBeNull();
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

    expect(screen.getByRole('header', { name: 'Expense Calc' })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Expenses')).toBeNull();
  });
});

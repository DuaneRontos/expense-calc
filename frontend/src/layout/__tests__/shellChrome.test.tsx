import { act, render, screen } from '@testing-library/react-native';

import { AppShell } from '../AppShell';
import { BREAKPOINTS, MIN_TOUCH_TARGET } from '../breakpoints';
import { ExpenseQueryProvider } from '../../expenses/ExpenseQueryProvider';
import { api } from '../../api/client';

/**
 * Two properties `AppShell` documents as settled and nothing enforced.
 *
 * Both were found by mutation while migrating the chrome in #117: deleting the
 * bottom safe-area inset, and deleting the navigation's touch-target floor,
 * each left all 75 layout tests green. The component's own doc comments
 * describe both as fixed bugs — which is exactly the shape that comes back.
 */
let mockWidth = BREAKPOINTS.compact - 1;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 900, scale: 2, fontScale: 1 }),
}));

// Non-zero on every edge, so an inset that is dropped shows up as a missing
// number rather than as a zero indistinguishable from the default.
const INSETS = { top: 59, bottom: 34, left: 21, right: 13 };
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 21, right: 13 }),
}));

jest.mock('expo-router', () => ({
  router: { navigate: () => {}, replace: () => {} },
  usePathname: () => '/expenses',
}));

const renderShell = () =>
  render(
    <ExpenseQueryProvider>
      <AppShell>
        <></>
      </AppShell>
    </ExpenseQueryProvider>,
  );

/**
 * A session, because the nav is only offered with one (`navGating.test.tsx`).
 * Web-shaped tokens so the refresh-token store is never touched.
 */
const signIn = () =>
  act(async () => {
    await api.session.adopt({ accessToken: 'access-1', expiresInSeconds: 900 }, true);
  });

afterEach(async () => {
  await act(async () => {
    await api.session.clear();
  });
});

describe('the shell container', () => {
  it('insets all four edges, not just the ones that look like they touch', async () => {
    /*
     * The bottom inset used to live on the tab bar, which only renders when
     * compact — so medium and expanded had none at all, and a landscape iPhone
     * is 852×393, which lands in *medium*. The last row of a screen's scroll
     * view ran under the home indicator.
     *
     * Asserted at the **medium** band for that reason: compact would pass on
     * the old arrangement too.
     */
    mockWidth = BREAKPOINTS.compact + 1;
    await signIn();
    await renderShell();

    const style = screen.getByTestId('shell-root').props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;

    expect(flat.paddingTop).toBe(INSETS.top);
    expect(flat.paddingBottom).toBe(INSETS.bottom);
    expect(flat.paddingLeft).toBe(INSETS.left);
    expect(flat.paddingRight).toBe(INSETS.right);
  });
});

describe('the navigation', () => {
  it.each([
    ['compact', BREAKPOINTS.compact - 1],
    ['medium', BREAKPOINTS.compact + 1],
    ['expanded', BREAKPOINTS.expanded + 1],
  ])('keeps the touch-target floor in the %s band', async (_band, width) => {
    // Spec §2: touch targets keep mobile sizing at every breakpoint — and this
    // is the entire navigation on two of the three. `min-h-touch` resolves to
    // MIN_TOUCH_TARGET via tailwind.config.ts, which
    // `theme/__tests__/tokensMatchTailwind` pins; this asserts the class is
    // still on the control.
    mockWidth = width;
    await signIn();
    await renderShell();

    const overview = screen.getByLabelText('Overview');

    expect(overview.props.className).toContain('min-h-touch');
    expect(MIN_TOUCH_TARGET).toBe(44);
  });
});

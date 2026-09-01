import { act, render, screen } from '@testing-library/react-native';

import { AppShell } from '../AppShell';
import { BREAKPOINTS } from '../breakpoints';
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
//
// `mock`-prefixed so jest's hoisted factory may read it, like `mockWidth`
// above — the numbers are written once rather than repeated inside the factory.
const mockInsets = { top: 59, bottom: 34, left: 21, right: 13 };
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
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

    expect(flat.paddingTop).toBe(mockInsets.top);
    expect(flat.paddingBottom).toBe(mockInsets.bottom);
    expect(flat.paddingLeft).toBe(mockInsets.left);
    expect(flat.paddingRight).toBe(mockInsets.right);
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

    // Token match, not a substring: `min-h-touch-2` (88dp, for multiline
    // inputs) contains `min-h-touch`, and both live in the same `twMerge`
    // group that `cn.ts` had to teach by hand — so a mis-merge leaving the
    // doubled height on a nav button is exactly what a substring would miss.
    //
    // No assertion on `MIN_TOUCH_TARGET`'s value here: `breakpoints.test.ts`
    // pins the floor as `>= 44` deliberately, so raising it is a legal change,
    // and restating `=== 44` in a layout suite would fail three tests here for
    // a reason that has nothing to do with the shell. `tokensMatchTailwind`
    // already ties the class to the constant.
    expect(overview.props.className.split(/\s+/)).toContain('min-h-touch');
  });
});

describe('the chrome text sizes', () => {
  /**
   * Sizes must not acquire a line height they never had.
   *
   * Tailwind's named font sizes are pairs — `text-lg` is 18 *and* a 28px line
   * height, `text-sm` is 14 *and* 20 — while the styles these replaced set a
   * `fontSize` and nothing else. Substituting the named class is the obvious
   * migration and it silently makes every line taller.
   *
   * **This has now recurred three times**: `Label` (#114), `ExpenseRow` (#116),
   * and both of this file's text elements — where I corrected the title and
   * left the nav label, because the size is the half people check and the line
   * height is the half they do not. A comment did not stop it; this does.
   */
  it('keeps the header title on an exact size', async () => {
    mockWidth = BREAKPOINTS.compact + 1;
    await signIn();
    await renderShell();

    // By role, not by text: the destination name appears twice — once as the
    // heading and once as its own nav item.
    const className = screen.getByRole('header').props.className;

    expect(className.split(/\s+/)).toContain('text-[18px]');
    expect(className.split(/\s+/)).not.toContain('text-lg');
  });

  it('keeps the band line on an exact size', async () => {
    mockWidth = BREAKPOINTS.compact + 1;
    await signIn();
    await renderShell();

    const className = screen.getByText(/layout · /).props.className;

    expect(className.split(/\s+/)).toContain('text-[12px]');
    expect(className.split(/\s+/)).not.toContain('text-xs');
  });

  it('keeps the navigation label on an exact size', async () => {
    mockWidth = BREAKPOINTS.compact - 1;
    await signIn();
    await renderShell();

    // The label is a child of the button queried above; `getByText` finds the
    // `Text` itself rather than the pressable.
    const className = screen.getByText('Overview').props.className;

    expect(className.split(/\s+/)).toContain('text-[14px]');
    expect(className.split(/\s+/)).not.toContain('text-sm');
  });
});

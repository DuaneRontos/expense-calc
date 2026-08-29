import { act, render, screen } from '@testing-library/react-native';

import { AppShell } from '../AppShell';
import { BREAKPOINTS, type LayoutSize } from '../breakpoints';
import { api } from '../../api/client';
import { ExpenseQueryProvider } from '../../expenses/ExpenseQueryProvider';

/**
 * The nav announces which destination you are on (issue #80).
 *
 * **Colour is not a cue.** The active item differs from the others by accent
 * colour and a bolder weight, and `accessibilityState` never reaches the DOM
 * under RNW (issue #69), so before this the navigation announced as identical
 * buttons on web. `role="button"` supports neither `selected` nor `checked` in
 * ARIA, which leaves the label as the only carrier — the same answer
 * `SortControl` reached.
 */
jest.mock('expo-router', () => ({
  usePathname: () => '/expenses',
  router: { navigate: () => {} },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../expenses/useCategories', () => ({
  useCategories: () => ({ categories: [], loading: false, error: null, retry: () => {} }),
}));

/**
 * The band is an input, not an accident.
 *
 * `AppShell` renders `NavButton` from three mutually exclusive places — the
 * medium header row, the expanded sidebar, the compact tab bar — chosen by
 * `useWindowDimensions`. Left unmocked the test exercises whichever band
 * jest-expo's default width lands in and silently never reaches the other two,
 * and a change to either the default or `BREAKPOINTS` would move it without
 * anyone choosing to.
 */
// `mock`-prefixed: jest hoists the factory above this, and only names
// matching that prefix may be referenced from inside one.
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

// Rendered above `AppShell` because the expanded band mounts `ExpenseFilters`
// itself, and `useExpenseQuery` throws outside a provider.
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
 * Web-shaped tokens so the refresh-token store is never touched: `viaCookie`
 * sets the access token and returns.
 */
const signIn = () => act(async () => {
  await api.session.adopt({ accessToken: 'access-1', expiresInSeconds: 900 }, true);
});

describe.each(BANDS)('AppShell navigation ($size)', (band) => {
  beforeEach(async () => {
    mockWidth = band.width;
    await api.session.clear();
  });

  afterEach(async () => {
    await act(async () => {
      await api.session.clear();
    });
  });

  it('names the current screen in its label, not just its colour', async () => {
    await renderShell();
    await signIn();

    expect(screen.getByLabelText('Expenses, current screen')).toBeOnTheScreen();
  });

  it('leaves the other destinations unqualified', async () => {
    await renderShell();
    await signIn();

    expect(screen.getByLabelText('Overview')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Overview, current screen')).toBeNull();
  });

  /**
   * `selected` is what carries `UIAccessibilityTraitSelected`, and `role`
   * `button` has no ARIA form for it — so the label fix does not make this
   * redundant, and deleting it as such would cost VoiceOver the only state the
   * app's one navigation conveys. Same case `PeriodPicker.test.tsx` pins.
   */
  it('keeps the iOS selected trait on the active destination', async () => {
    await renderShell();
    await signIn();

    expect(screen.getByLabelText('Expenses, current screen')).toBeSelected();
    expect(screen.getByLabelText('Overview')).not.toBeSelected();
  });
});

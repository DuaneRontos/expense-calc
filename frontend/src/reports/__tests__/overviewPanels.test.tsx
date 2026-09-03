import { act, render, screen } from '@testing-library/react-native';

// Imported from outside `app/` on purpose: expo-router turns every `.tsx`
// there into a route. Same reason as `overview.test.tsx`.
import Overview from '../../../app/index';
import { api } from '../../api/client';
import { BREAKPOINTS } from '../../layout/breakpoints';
import { formatMoney } from '../../money/format';
import type { CategoryBreakdown, PeriodComparison, SpendOverTime } from '../../api/types';

jest.mock('expo-router/head', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-router', () => ({
  router: { navigate: () => {}, replace: () => {} },
  usePathname: () => '/',
}));

let mockWidth = BREAKPOINTS.expanded + 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 900, scale: 2, fontScale: 1 }),
}));

const PERIOD = { from: '2026-08-01', to: '2026-09-01' };

const breakdown: CategoryBreakdown = {
  period: PERIOD,
  currency: 'PHP',
  // Deliberately unlike any bucket below: the donut renders the period total
  // and the legend repeats each bucket, so a shared value makes the query
  // ambiguous rather than wrong.
  total: '54321.00',
  buckets: [{ key: 'GROCERIES', label: 'Groceries', total: '100.00' }],
};

const overTime: SpendOverTime = {
  period: PERIOD,
  bucket: 'DAY',
  currency: 'PHP',
  total: '100.00',
  buckets: [{ key: '2026-08-01', label: '1 Aug 2026', total: '100.00' }],
};

const comparison: PeriodComparison = {
  current: PERIOD,
  previous: { from: '2026-07-01', to: '2026-08-01' },
  currency: 'PHP',
  currentTotal: '100.00',
  previousTotal: '30000.00',
  // Non-empty so the accessible table renders: with no buckets the chart takes
  // its "Nothing recorded in either period." branch and the headings never
  // mount, which is how `ComparisonChart` went uncovered in the first place.
  buckets: [
    { key: 'GROCERIES', label: 'Groceries', current: '100.00', previous: '80.00', change: '20.00' },
  ],
};

beforeEach(async () => {
  await api.session.clear();
  await act(async () => {
    await api.session.adopt({ accessToken: 'access-1', expiresInSeconds: 900 }, true);
  });
  jest.spyOn(api, 'byCategory').mockResolvedValue(breakdown);
  jest.spyOn(api, 'overTime').mockResolvedValue(overTime);
  jest.spyOn(api, 'compare').mockResolvedValue(comparison);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await act(async () => {
    await api.session.clear();
  });
});

/**
 * The chart panels take `flex-1` **only** in the expanded row.
 *
 * In a column inside a `ScrollView` the cross axis is unbounded, so `flex: 1`
 * resolves to `flexBasis: 0%` — each panel claims zero height and its chart
 * draws over the section beneath it. It looks like a z-index problem and is
 * not one, which is why `app/index.tsx` keeps the two classes separate and
 * documents it at length.
 *
 * That reasoning was in a comment and nothing else: emptying `PANEL_IN_ROW`
 * left every test green.
 */
// **Both** panels in the row, not just the first. The trap is per-panel, and
// the second one holds the BarChart — guarding only `by-category` left dropping
// `PANEL_IN_ROW` from `over-time` passing the whole suite.
const PANELS = ['panel-by-category', 'panel-over-time'];

describe('the Overview chart panels', () => {
  it.each(PANELS)('%s takes flex-1 when the panels sit in a row', async (testID) => {
    mockWidth = BREAKPOINTS.expanded + 1;
    await render(<Overview />);

    const panel = await screen.findByTestId(testID);

    expect(panel.props.className.split(/\s+/)).toContain('flex-1');
  });

  it.each([
    ['compact', BREAKPOINTS.compact - 1],
    ['medium', BREAKPOINTS.compact + 1],
  ])('neither takes it in the %s band, where the cross axis is unbounded', async (_band, width) => {
    mockWidth = width;
    await render(<Overview />);

    for (const testID of PANELS) {
      const panel = await screen.findByTestId(testID);

      expect(panel.props.className.split(/\s+/)).not.toContain('flex-1');
    }
  });
});

/**
 * Explicit sizes stay explicit.
 *
 * Tailwind's named sizes are pairs — `text-xl` is 20 *and* a 28px line height,
 * `text-xs` is **12** and a 16px one — while the styles these replaced set a
 * `fontSize` and nothing else. Swapping `text-[11px]` for `text-xs` changes
 * both the line height *and* the font size, and until this suite existed it
 * changed neither test.
 *
 * This is the guard `shellChrome.test.tsx` added for the AppShell chrome in
 * #143, applied to the surfaces #145 touched. A comment did not stop it there
 * and did not stop it here.
 */
describe('the reporting frame text sizes', () => {
  it('keeps the donut total on an exact size', async () => {
    mockWidth = BREAKPOINTS.expanded + 1;
    await render(<Overview />);

    const total = await screen.findByText(formatMoney('54321.00'));
    const className = total.props.className.split(/\s+/);

    expect(className).toContain('text-[20px]');
    expect(className).not.toContain('text-xl');
  });

  it('keeps the comparison table headings on an exact size', async () => {
    mockWidth = BREAKPOINTS.expanded + 1;
    await render(<Overview />);

    const heading = await screen.findByText('Category');
    const className = heading.props.className.split(/\s+/);

    expect(className).toContain('text-[11px]');
    expect(className).not.toContain('text-xs');
  });

  it('keeps every period description on an exact size', async () => {
    mockWidth = BREAKPOINTS.expanded + 1;
    await render(<Overview />);

    // `describePeriod` renders "<from> up to but not including <to>" against
    // today in Asia/Manila, so the dates are not fixed — the phrasing is. It
    // appears twice: the picker's caption and the comparison's. Asserting over
    // both is stronger than disambiguating, since either could drift.
    await screen.findByText('Category');
    const described = screen.getAllByText(/up to but not including/);

    expect(described.length).toBeGreaterThan(0);

    for (const node of described) {
      const className = node.props.className.split(/\s+/);

      expect(className.some((c: string) => /^text-\[\d+px\]$/.test(c))).toBe(true);
      expect(className).not.toContain('text-xs');
      expect(className).not.toContain('text-sm');
    }
  });
});

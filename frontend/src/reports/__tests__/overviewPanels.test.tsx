import { act, render, screen } from '@testing-library/react-native';

// Imported from outside `app/` on purpose: expo-router turns every `.tsx`
// there into a route. Same reason as `overview.test.tsx`.
import Overview from '../../../app/index';
import { api } from '../../api/client';
import { BREAKPOINTS } from '../../layout/breakpoints';
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
  total: '100.00',
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
  buckets: [],
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
describe('the Overview chart panels', () => {
  it('take flex-1 when they sit in a row', async () => {
    mockWidth = BREAKPOINTS.expanded + 1;
    await render(<Overview />);

    const panel = await screen.findByTestId('panel-by-category');

    expect(panel.props.className.split(/\s+/)).toContain('flex-1');
  });

  it.each([
    ['compact', BREAKPOINTS.compact - 1],
    ['medium', BREAKPOINTS.compact + 1],
  ])('do not take it in the %s band, where the cross axis is unbounded', async (_band, width) => {
    mockWidth = width;
    await render(<Overview />);

    const panel = await screen.findByTestId('panel-by-category');

    expect(panel.props.className.split(/\s+/)).not.toContain('flex-1');
  });
});

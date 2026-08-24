import { render, screen } from '@testing-library/react-native';

import { AppShell } from '../AppShell';

/**
 * The nav announces which destination you are on (issue #80).
 *
 * **Colour is not a cue.** The active item differs from the others by accent
 * colour and a bolder weight, and `accessibilityState` never reaches the DOM
 * under RNW (issue #69), so before this the whole navigation announced as
 * identical buttons on web. `role="button"` supports neither `selected` nor
 * `checked` in ARIA, which leaves the label as the only carrier — the same
 * answer `SortControl` reached.
 */
jest.mock('expo-router', () => ({
  usePathname: () => '/expenses',
  router: { navigate: () => {} },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('AppShell navigation', () => {
  it('names the current screen in its label, not just its colour', async () => {
    await render(
      <AppShell>
        <></>
      </AppShell>,
    );

    expect(screen.getByLabelText('Expenses, current screen')).toBeTruthy();
  });

  it('leaves the other destinations unqualified', async () => {
    await render(
      <AppShell>
        <></>
      </AppShell>,
    );

    expect(screen.getByLabelText('Overview')).toBeTruthy();
    expect(screen.queryByLabelText('Overview, current screen')).toBeNull();
  });
});

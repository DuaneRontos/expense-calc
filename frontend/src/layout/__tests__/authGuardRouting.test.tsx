import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { AuthGuard } from '../AuthGuard';
import type { AuthGate } from '../../api/useAuthGate';

/**
 * The half `authGuard.test.tsx` cannot cover.
 *
 * That suite mocks `expo-router` wholesale and replaces `Redirect` with a
 * marker, which proves the guard *asked* to navigate and nothing more. Whether a
 * `Redirect` rendered from a root layout — in place of the navigator, rather
 * than from inside a screen — actually lands is a different claim, and it is the
 * one worth pinning: `Redirect` hands an un-memoized arrow to `useFocusEffect`,
 * so its effect re-runs on every render and fires `router.replace` again. Inside
 * a screen that is harmless, because the screen unmounts. Inside a layout that
 * outlives the navigation it is the shape of an update loop.
 */
const mockGate = { current: 'resolving' as AuthGate };
jest.mock('../../api/useAuthGate', () => ({
  useAuthGate: () => mockGate.current,
}));

function routes() {
  return {
    _layout: () => (
      <AuthGuard>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthGuard>
    ),
    index: () => <Text>overview</Text>,
    'sign-in': () => <Text>the form</Text>,
    expenses: () => <Text>the list</Text>,
  };
}

describe('the guard, driven through the real router', () => {
  it('lands a signed-out cold load on the sign-in screen', async () => {
    // `Redirect` swallows a failed `replace` into `console.error`, so without
    // watching it a silent failure to navigate is indistinguishable from a slow
    // one — and a re-render loop reports itself the same way.
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGate.current = 'signed-out';

    await renderRouter(routes(), { initialUrl: '/expenses' });

    expect(await screen.findByText('the form')).toBeOnTheScreen();
    expect(errors).not.toHaveBeenCalled();
  });

  it('renders the app when the session resolves the other way', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGate.current = 'signed-in';

    await renderRouter(routes(), { initialUrl: '/expenses' });

    expect(await screen.findByText('the list')).toBeOnTheScreen();
    expect(errors).not.toHaveBeenCalled();
  });

  it('does not navigate while the session is still in question', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGate.current = 'resolving';

    await renderRouter(routes(), { initialUrl: '/expenses' });

    // Anchored on the spinner, so the absence below sits in a tree that exists.
    expect(await screen.findByLabelText('Checking your session')).toBeOnTheScreen();
    expect(screen.queryByText('the form')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});

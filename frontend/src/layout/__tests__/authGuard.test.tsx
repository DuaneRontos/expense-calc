import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AuthGuard } from '../AuthGuard';
import type { AuthGate } from '../../api/useAuthGate';

// `mock`-prefixed so jest's hoisted factory may read them. See `AppShell.test.tsx`.
const mockGate = { current: 'resolving' as AuthGate };
const mockPath = { current: '/' };
const mockRedirects: string[] = [];

jest.mock('../../api/useAuthGate', () => ({
  useAuthGate: () => mockGate.current,
}));

jest.mock('expo-router', () => ({
  usePathname: () => mockPath.current,
  // A marker rather than a navigation: what matters is that the guard asked to
  // go somewhere, and where.
  Redirect: ({ href }: { href: string }) => {
    mockRedirects.push(href);
    return null;
  },
}));

function renderGuard() {
  return render(
    <AuthGuard>
      <Text>the app</Text>
    </AuthGuard>,
  );
}

beforeEach(() => {
  mockGate.current = 'resolving';
  mockPath.current = '/';
  mockRedirects.length = 0;
});

describe('AuthGuard', () => {
  it('shows neither the app nor a redirect while the session is still in question', async () => {
    // **The case that makes the guard usable on web.** The credential is a
    // cookie no script can read, so a returning visitor looks signed out until
    // `/auth/refresh` answers. Redirecting on that would bounce exactly the
    // people who are signed in.
    mockGate.current = 'resolving';

    await renderGuard();

    // Anchored on something known to be on screen, so the two absences below
    // are absences within a tree that exists.
    const spinner = screen.getByLabelText('Checking your session');
    expect(spinner).toBeOnTheScreen();
    // **Which element carries the label is the assertion, not merely that one
    // does.** `getByLabelText` reads the prop, so it is satisfied by a label on
    // the wrapping `View` — where react-native-web renders a role-less `div`,
    // ARIA forbids naming it, and the name is dropped. The indicator is the
    // element that already has `role="progressbar"` to hang a name on.
    expect(spinner.type).toBe('ActivityIndicator');
    expect(screen.queryByText('the app')).toBeNull();
    expect(mockRedirects).toHaveLength(0);
  });

  it('sends a signed-out visitor to the sign-in screen', async () => {
    mockGate.current = 'signed-out';
    mockPath.current = '/expenses';

    await renderGuard();

    expect(mockRedirects).toEqual(['/sign-in']);
    expect(screen.queryByText('the app')).toBeNull();
  });

  it('lets the sign-in screen itself render while signed out', async () => {
    // Without this the guard redirects its own escape hatch, and the app is a
    // redirect loop that never reaches a form.
    mockGate.current = 'signed-out';
    mockPath.current = '/sign-in';

    await renderGuard();

    expect(screen.getByText('the app')).toBeOnTheScreen();
    expect(mockRedirects).toHaveLength(0);
  });

  it('gets out of the way once there is a session', async () => {
    mockGate.current = 'signed-in';
    mockPath.current = '/expenses';

    await renderGuard();

    expect(screen.getByText('the app')).toBeOnTheScreen();
    expect(mockRedirects).toHaveLength(0);
  });
});

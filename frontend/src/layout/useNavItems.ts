import { router, usePathname } from 'expo-router';
import { useCallback, useMemo } from 'react';

import type { NavItem } from './AppShell';

/**
 * The app's navigation destinations, shared by every route.
 *
 * Defined once rather than inline per screen. Two copies of the same array
 * drifted apart the moment one of them changed, and a fresh array literal with
 * fresh closures on every render also makes `AppShell` impossible to memoize.
 */

const DESTINATIONS = [
  { key: 'overview', label: 'Overview', href: '/' },
  { key: 'expenses', label: 'Expenses', href: '/expenses' },
] as const;

export function useNavItems(): NavItem[] {
  const pathname = usePathname();

  const go = useCallback(
    (href: (typeof DESTINATIONS)[number]['href'], active: boolean) => () => {
      // Already here — pushing would stack a duplicate of the current route.
      if (active) {
        return;
      }
      // `navigate`, not `push`. These are peer destinations, and `push` always
      // appends: Overview → Expenses → Overview leaves three entries for two
      // screens, so Android's hardware back button walks that history instead
      // of leaving the app, and the browser back button does the same on web.
      router.navigate(href);
    },
    [],
  );

  return useMemo(
    () =>
      DESTINATIONS.map((destination) => {
        const active = pathname === destination.href;
        return {
          key: destination.key,
          label: destination.label,
          active,
          onPress: go(destination.href, active),
        };
      }),
    [pathname, go],
  );
}

import { router, usePathname } from 'expo-router';
import { useCallback, useMemo } from 'react';

/**
 * The app's navigation destinations, and the hooks that read them.
 *
 * One list, consulted by the nav controls at every breakpoint and by the
 * header. Two copies of this drifted apart the moment one of them changed.
 *
 * Lives here rather than in `AppShell` so that the shell can import the hooks
 * without the hooks importing the shell back for a type.
 */

export interface NavItem {
  key: string;
  label: string;
  onPress?: () => void;
  active?: boolean;
}

const DESTINATIONS = [
  { key: 'overview', label: 'Overview', href: '/' },
  { key: 'expenses', label: 'Expenses', href: '/expenses' },
] as const;

type Destination = (typeof DESTINATIONS)[number];

function useActiveDestination(): Destination | undefined {
  const pathname = usePathname();
  return DESTINATIONS.find((destination) => destination.href === pathname);
}

/**
 * The title for the shared header.
 *
 * Falls back to the app name rather than to an empty string: `+not-found` and
 * `_sitemap` are real routes that render inside this chrome, and a header with
 * no text reads as a rendering failure.
 */
export function useActiveTitle(): string {
  return useActiveDestination()?.label ?? 'Expense Calc';
}

export function useNavItems(): NavItem[] {
  const pathname = usePathname();

  const go = useCallback(
    (href: Destination['href'], active: boolean) => () => {
      // Already here — navigating would stack a duplicate of the current route.
      if (active) {
        return;
      }
      // `navigate`, not `push`. These are peer destinations, and `push` always
      // appends: Overview → Expenses → Overview leaves three entries for two
      // screens, so Android's hardware back button walks that history instead
      // of leaving the app.
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

import { router, usePathname } from 'expo-router';
import { useCallback, useMemo } from 'react';

/**
 * The app's navigation destinations, and the hooks that read them.
 *
 * One list, consulted by the nav controls at every breakpoint, by the shell
 * header, and by each route's web title. Two copies of this drifted apart the
 * moment one of them changed.
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

export const APP_NAME = 'Expense Calc';

export const DESTINATIONS = [
  { key: 'overview', label: 'Overview', href: '/' },
  { key: 'expenses', label: 'Expenses', href: '/expenses' },
] as const;

export type Destination = (typeof DESTINATIONS)[number];

export type DestinationKey = Destination['key'];

function destination(key: DestinationKey): Destination {
  // Non-null: `key` is a union of the literal keys, so this cannot miss.
  return DESTINATIONS.find((candidate) => candidate.key === key)!;
}

/** The label shown in the shell header and on the nav controls. */
export function labelFor(key: DestinationKey): string {
  return destination(key).label;
}

/**
 * The browser tab title for a route.
 *
 * Derived rather than restated. Each route still needs its own `<Head>` — the
 * navigator's `title` option does not drive `document.title` when the header is
 * hidden — but that is a reason to repeat the *mechanism*, not the string.
 * Renaming a destination used to leave the tab and the screen-change
 * announcement both saying the old name, with nothing failing to say so.
 */
export function webTitleFor(key: DestinationKey): string {
  return `${labelFor(key)} · ${APP_NAME}`;
}

/**
 * Strips a trailing slash so `/expenses/` and `/expenses` are the same route.
 *
 * `app.json` sets `web.output: "static"`, and which of the two is canonical is
 * the host's decision rather than Expo's — a host that canonicalises to the
 * trailing-slash form would otherwise serve a page with no active nav item and
 * a generic header.
 */
function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname || '/';
}

/**
 * The destination a pathname belongs to, or undefined for a route that is not
 * one of them — `+not-found` and `_sitemap` both render inside this chrome.
 *
 * Pure, so it can be tested without a renderer. The index route matches exactly
 * and the others by prefix: `/expenses/123` is a detail view of the expense
 * list (#14 will want one) and belongs to that destination, but `/` must not
 * swallow every path in the app.
 */
export function matchDestination(pathname: string): Destination | undefined {
  const path = normalize(pathname);

  return DESTINATIONS.find((candidate) => {
    if (candidate.href === '/') {
      return path === '/';
    }
    return path === candidate.href || path.startsWith(`${candidate.href}/`);
  });
}

export function useActiveDestination(): Destination | undefined {
  return matchDestination(usePathname());
}

/**
 * The title for the shared header.
 *
 * Falls back to the app name rather than to an empty string: `+not-found` and
 * `_sitemap` are real routes that render inside this chrome, and a header with
 * no text reads as a rendering failure.
 */
export function useActiveTitle(): string {
  return useActiveDestination()?.label ?? APP_NAME;
}

export function useNavItems(): NavItem[] {
  const pathname = usePathname();
  const active = matchDestination(pathname);

  const go = useCallback(
    (href: Destination['href'], isActive: boolean) => () => {
      // Already here — navigating would stack a duplicate of the current route.
      if (isActive) {
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
      DESTINATIONS.map((candidate) => {
        const isActive = candidate.key === active?.key;
        return {
          key: candidate.key,
          label: candidate.label,
          active: isActive,
          onPress: go(candidate.href, isActive),
        };
      }),
    [active, go],
  );
}

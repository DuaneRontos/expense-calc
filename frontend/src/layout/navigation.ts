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
  /** Required: `useNavItems` is the only producer and always supplies both. */
  onPress: () => void;
  active: boolean;
}

export const APP_NAME = 'Expense Calc';

export const DESTINATIONS = [
  /**
   * `filterable` gates the shell's filter chrome. The Overview renders reports
   * over their own periods and has no expense query behind it, so a "Filters"
   * button there opens controls that would change nothing on screen.
   */
  { key: 'overview', label: 'Overview', href: '/', filterable: false },
  { key: 'expenses', label: 'Expenses', href: '/expenses', filterable: true },
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
 * one of them — a custom `app/+not-found.tsx` would be one such route.
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

/**
 * Whether a pathname is exactly a destination's own route.
 *
 * Distinct from {@link matchDestination}, which matches a whole section. The
 * two answer different questions: being *within* Expenses is why the tab is
 * highlighted on `/expenses/{id}`, and being *exactly* on `/expenses` is the
 * only reason tapping it should do nothing.
 */
export function isExactly(pathname: string, href: string): boolean {
  return normalize(pathname) === href;
}

export function useActiveDestination(): Destination | undefined {
  return matchDestination(usePathname());
}

/**
 * Whether the current route has something for the filter chrome to filter.
 *
 * **Prefix matching is right for the nav and wrong for this.** `/expenses/new`
 * and `/expenses/{id}` belong to the Expenses destination — the tab should stay
 * highlighted on them — but neither shows a list, so the filter panel there
 * offers controls that change nothing on screen. The destination is matched by
 * prefix; the filters are matched exactly.
 */
export function useShowsFilters(): boolean {
  const pathname = usePathname();
  const destination = matchDestination(pathname);

  if (!destination?.filterable) {
    return false;
  }
  return normalize(pathname) === destination.href;
}

export function useNavItems(): NavItem[] {
  const pathname = usePathname();
  const active = matchDestination(pathname);
  const here = normalize(pathname);

  const go = useCallback(
    (href: Destination['href'], isHere: boolean) => () => {
      // Already on this exact route — navigating would stack a duplicate.
      //
      // **Exactly here, not merely within.** Gating on the highlighted
      // destination instead made the tab inert on every nested route: from
      // `/expenses/{id}` the Expenses tab is lit, so tapping it did nothing and
      // the only way back to the list was the browser's back button. Being
      // inside a section is a reason to highlight it, not a reason to refuse to
      // go to its top.
      if (isHere) {
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
      DESTINATIONS.map((candidate) => ({
        key: candidate.key,
        // Highlighted for the whole section, including nested routes.
        active: candidate.key === active?.key,
        label: candidate.label,
        // Navigable unless this is precisely where we already are.
        onPress: go(candidate.href, here === candidate.href),
      })),
    [active, here, go],
  );
}

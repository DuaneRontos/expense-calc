import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SignOutButton } from './SignOutButton';
import { useSignedIn } from '../api/useSignedIn';
import { APP_NAME, useActiveDestination, useNavItems, useShowsFilters, type NavItem } from './navigation';
import { useLayout } from './useLayout';
import { ExpenseFilters } from '../expenses/ExpenseFilters';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { cn } from '../ui/cn';

/**
 * The one layout system of spec §2, expressed as a single component.
 *
 * Three breakpoints, one tree. The navigation and the filter panel each move —
 * bottom tabs and a hidden drawer when compact, a top row and a disclosure when
 * medium, a persistent sidebar when expanded — but the content is the same
 * children in all three, which is what keeps iOS, Android and desktop web from
 * drifting into three different apps.
 *
 * **Every band gets an explicit answer for both.** An earlier version gave
 * bottom tabs to compact and the sidebar to expanded, and medium — every tablet
 * in portrait — silently inherited neither. A band that is not named anywhere
 * does not fall back to something sensible; its content is simply dropped.
 *
 * **Mounted once, in the layout route, wrapping the navigator.** It used to be
 * mounted inside each screen, which looked identical on web and was wrong on
 * native: `native-stack` animates the whole screen, so switching destinations
 * slid the header, the nav row and the tab bar off while an identical copy slid
 * on. Persistent chrome that animates like content is one of the clearest
 * "this was built for the browser" tells on a device. It also closed the filter
 * drawer on every navigation, because that state lived in a component that
 * remounted.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const nav = useNavItems();

  /**
   * The nav is not offered without a session.
   *
   * `AuthGuard` keeps a signed-out visitor on `/sign-in`, but this shell still
   * renders around that screen — and `useNavItems` navigates unconditionally,
   * with no session check of its own. So the controls were a way into a
   * protected route from the one route the guard has to leave reachable: the
   * screen mounted and ran its effects, and the guard's redirect chased it.
   *
   * Withdrawing them is upstream of that race rather than another participant
   * in it. `useSignedIn` rather than a mount-time read, so the controls appear
   * on sign-in and leave on sign-out without the shell remounting.
   *
   * **Gated at the three render sites, not by emptying `nav`.** Both work, and
   * doing both is what a first attempt here did — but two redundant gates mean
   * removing either one leaves the tests green, so neither is pinned. Gating
   * where the chrome is drawn is the one that also avoids leaving an empty
   * bordered strip behind in the compact band.
   */
  const signedIn = useSignedIn();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // One `usePathname` subscription for the whole shell. The title, the active
  // nav state and the filter guard all derive from this — asking three
  // different hooks for it re-ran the same match three times per render, on
  // the component that is now the root of the tree.
  const active = useActiveDestination();

  // Falls back to the app name rather than an empty string: a route that is not
  // a destination still renders inside this chrome, and a header with no text
  // reads as a rendering failure.
  const title = active?.label ?? APP_NAME;

  // Not every route under this layout has something to filter, and a "Filters"
  // button on one opens controls that would change nothing on screen. The
  // Overview is a real destination with no expense query behind it, so this is
  // a per-destination flag rather than "is this a destination at all".
  //
  // Defensive rather than observed: Expo's built-in `_sitemap` and
  // unmatched-route screens replace the layout entirely rather than rendering
  // inside it, so neither shows the affordance today — both were checked. A
  // *custom* `app/+not-found.tsx` would render inside this chrome, and the web
  // export already emits that page, which is the case this guard exists for.
  // Exact-matched, not prefix-matched: a detail or create route belongs to the
  // Expenses destination for navigation, and has no list for filters to act on.
  const filterable = useShowsFilters();
  const showsDrawer = !layout.isExpanded && filterable;

  return (
    <View
      // A handle for `shellChrome.test.tsx`, which asserts all four safe-area
      // insets land here. There is no accessible name to query the root by, and
      // dropping one of these insets passed every test until that suite existed.
      testID="shell-root"
      className="flex-1 bg-background"
      style={{
        // All four insets live here rather than on the pieces that happen to
        // touch an edge. The bottom one used to sit on the tab bar, which only
        // renders when compact — so medium and expanded had none at all, and a
        // landscape iPhone is 852×393, which lands in *medium*. The last row of
        // a screen's scroll view ran under the home indicator.
        //
        // The trade of insetting the container: the header's hairline border
        // stops short of the physical edges on a notched phone instead of
        // running full-bleed. That is deliberate — don't "fix" it back without
        // moving the insets onto the content first.
        //
        // Runtime values from `useSafeAreaInsets`, so these stay a `style`
        // object: there is no class for a number that is only known on device.
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <View className="border-b border-border px-4 py-2">
        {/*
          A real heading, not just large bold text. react-native-web maps
          `header` onto `role="heading"`, and native onto the iOS header trait,
          so this is the landmark a screen reader jumps between screens by —
          the one thing on the page that says which screen this is.
        */}
        {/*
          `text-[18px]`, not `text-lg`. Tailwind pairs `lg` with a 28px line
          height; the old `fontSize: 18` had none and took the platform's. On a
          heading that is a taller header band on every screen — the same
          one-property drift `Label` and `ExpenseRow` each had to undo.
        */}
        <Text accessibilityRole="header" className="text-[18px] font-bold text-text">
          {title}
        </Text>
        {/* `text-[12px]`, not `text-xs`: Tailwind's `xs` pairs a 16px line
            height that the old `fontSize: 12` did not have. */}
        <Text className="text-[12px] text-textMuted">
          {/* Surfaced on purpose: this scaffold's job is to prove one codebase
              drives all three targets, and the band is the thing to verify. */}
          {layout.size} layout · {Math.round(layout.width)}px
        </Text>

        <View className="flex-row items-center gap-4">
          {/* The medium band's navigation: no bottom tabs, no sidebar to put it in. */}
          {layout.isMedium && signedIn ? (
            <View className="mt-2 flex-1 flex-row gap-4">
              {nav.map((item) => (
                <NavButton key={item.key} item={item} />
              ))}
            </View>
          ) : null}

          {showsDrawer ? (
            <Button
              variant="link"
              // The flat prop alone, for the reason PeriodPicker spells out:
              // it is the only form that reaches all three targets, since RNW
              // forwards no `accessibilityState` and RN merges `aria-expanded`
              // back into it on native. Pairing it with a same-key
              // `accessibilityState` would be dead weight — unlike the radios,
              // which pass a *different* key there because ARIA has no form
              // for the iOS trait on their role.
              //
              // The label carries the action too, because `expanded` is the
              // weakest of the iOS states and VoiceOver may drop it. That
              // redundancy is the fix, not a smell.
              aria-expanded={drawerOpen}
              accessibilityLabel={drawerOpen ? 'Hide filters' : 'Show filters'}
              onPress={() => setDrawerOpen((open) => !open)}
            >
              <Text>{drawerOpen ? 'Hide filters' : 'Filters'}</Text>
            </Button>
          ) : null}

          {/*
            Last in the row and outside the drawer guard: signing out is
            available on every route under this chrome, including the ones with
            nothing to filter. It renders nothing at all when there is no
            session, so on an auth-disabled backend this row is unchanged.
          */}
          <SignOutButton />
        </View>
      </View>

      {/*
        The collapsible drawer of spec §2. Rendered inline above the content
        rather than as an overlay: an overlay needs focus trapping and a scrim
        to be correct, and #14 owns the real filter UI. What matters here is
        that the panel is reachable at all.

        Now that the shell outlives navigation, an open drawer stays open when
        the destination changes — which is the behaviour a filter panel wants.
      */}
      {showsDrawer && drawerOpen ? (
        <View
          // Announces the panel's arrival on Android and web. Landing on the
          // toggle tells a screen-reader user its state; nothing otherwise
          // tells them content appeared elsewhere on the screen.
          accessibilityLiveRegion="polite"
          className="border-b border-border bg-surface"
          style={{
            // Bounded and scrollable: a phone in landscape is 667×375, which
            // lands in the *medium* band, so #14's real filter panel would
            // otherwise fill the viewport and push the content out of reach.
            //
            // Stays a `style`: it is a fraction of the live viewport height,
            // which no class can express.
            maxHeight: Math.round(layout.height * 0.5),
          }}
        >
          <ScrollView contentContainerClassName="p-4">
            <ExpenseFilters />
          </ScrollView>
        </View>
      ) : null}

      <View className={cn('flex-1', layout.isExpanded ? 'flex-row' : 'flex-col')}>
        {/*
          Gated on having something to put in it. Both children are conditional
          — the nav on the session, the filters on the destination — and signed
          out on `/sign-in` neither holds, which left a 280px bordered column
          with nothing in it beside the form. `filterable` stays in the
          condition because a signed-out visitor on `/expenses` during the
          redirect window still has filters worth showing.
        */}
        {layout.isExpanded && (signedIn || filterable) ? (
          <View testID="nav-sidebar" className="w-[280px] border-r border-border bg-surface p-4">
            {/* The inner gate stays: the container may be here for the filters
                alone, and the destinations should not come with them. */}
            {signedIn ? (
              <View className="mb-6 gap-1">
                {nav.map((item) => (
                  <NavButton key={item.key} item={item} align="left" />
                ))}
              </View>
            ) : null}
            {filterable ? <ExpenseFilters /> : null}
          </View>
        ) : null}

        {/*
          The navigator. Screens bring their own scrolling — a `ScrollView` here
          would wrap the whole stack, so every screen would share one scroll
          offset and a screen that needs a `FlatList` (#14's expense list, which
          must not render 200 rows eagerly) could not have one.
        */}
        <View className="flex-1">{children}</View>
      </View>

      {/* Signed out, this would be a bordered strip with nothing in it. */}
      {layout.isCompact && signedIn ? (
        <View
          testID="nav-tab-bar"
          className="flex-row border-t border-border"
        >
          {nav.map((item) => (
            <NavButton key={item.key} item={item} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * `Pressable`, not a `Text` with `onPress`.
 *
 * On web react-native-web renders both as a real `<button>` with `tabIndex=0`,
 * so keyboard focus was never the problem it looked like. On native the
 * difference is real: a `Text` gets no press feedback and its hit rect is the
 * glyph frame, and this is the entire navigation on two of the three
 * breakpoints.
 */
function NavButton({ item, align = 'center' }: { item: NavItem; align?: 'center' | 'left' }) {
  return (
    <Pressable
      accessibilityRole="button"
      // The active destination is spelled out, the way SortControl spells out
      // its sort state. ARIA has nothing for this on `role="button"` —
      // `selected` and `checked` are both unsupported there — and RNW forwards
      // no `accessibilityState` anyway (issue #69), so on web the label is the
      // only thing that can carry it. Leaving it to the accent colour and the
      // bolder weight would make colour the sole cue, which spec §10 rejects.
      accessibilityLabel={item.active ? `${item.label}, current screen` : item.label}
      accessibilityState={{ selected: item.active }}
      onPress={item.onPress}
      className={cn(
        // Spec §2: touch targets keep mobile sizing at every breakpoint.
        // `min-h-touch` is `MIN_TOUCH_TARGET`, not the visually similar
        // `min-h-11`, which is only 44 while `inlineRem` is 16.
        'min-h-touch justify-center py-2',
        align === 'center' ? 'flex-1' : '',
      )}
    >
      {/*
        `text-[14px]`, which is what this was: the old style set colour, weight
        and alignment and no `fontSize`, so it took react-native-web's base of
        14 with the platform's own line height.
        
        Not `text-sm` — that is 14 *and* an imposed 20px line height, the same
        one-property drift `text-lg` would have added to the title above. I
        fixed the title and left this, which is how the drift keeps recurring:
        the size is the obvious half and the line height is the half nobody
        checks. `shellChrome.test.tsx` now pins both.
      */}
      <Text
        className={cn(
          'text-[14px]',
          align === 'center' ? 'text-center' : 'text-left',
          item.active ? 'font-semibold text-accent' : 'font-normal text-textMuted',
        )}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

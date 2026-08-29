import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MIN_TOUCH_TARGET } from './breakpoints';
import { SignOutButton } from './SignOutButton';
import { useSignedIn } from '../api/useSignedIn';
import { APP_NAME, useActiveDestination, useNavItems, useShowsFilters, type NavItem } from './navigation';
import { useLayout } from './useLayout';
import { ExpenseFilters } from '../expenses/ExpenseFilters';
import { palette, spacing } from '../theme/tokens';

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
      style={{
        flex: 1,
        backgroundColor: palette.background,
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
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <View
        style={{
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: palette.text }}>{title}</Text>
        <Text style={{ color: palette.textMuted, fontSize: 12 }}>
          {/* Surfaced on purpose: this scaffold's job is to prove one codebase
              drives all three targets, and the band is the thing to verify. */}
          {layout.size} layout · {Math.round(layout.width)}px
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          {/* The medium band's navigation: no bottom tabs, no sidebar to put it in. */}
          {layout.isMedium && signedIn ? (
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, flex: 1 }}>
              {nav.map((item) => (
                <NavButton key={item.key} item={item} />
              ))}
            </View>
          ) : null}

          {showsDrawer ? (
            <Pressable
              accessibilityRole="button"
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
              style={{
                minHeight: MIN_TOUCH_TARGET,
                // Symmetric, so the label sits in the middle of its 44dp target
                // rather than top-aligned with the tap centre somewhere below it.
                justifyContent: 'center',
                paddingVertical: spacing.sm,
              }}
            >
              <Text style={{ color: palette.accent, fontWeight: '600' }}>
                {drawerOpen ? 'Hide filters' : 'Filters'}
              </Text>
            </Pressable>
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
          style={{
            // Bounded and scrollable: a phone in landscape is 667×375, which
            // lands in the *medium* band, so #14's real filter panel would
            // otherwise fill the viewport and push the content out of reach.
            maxHeight: Math.round(layout.height * 0.5),
            backgroundColor: palette.surface,
            borderBottomWidth: 1,
            borderBottomColor: palette.border,
          }}
        >
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            <ExpenseFilters />
          </ScrollView>
        </View>
      ) : null}

      <View style={{ flex: 1, flexDirection: layout.isExpanded ? 'row' : 'column' }}>
        {layout.isExpanded ? (
          <View
            style={{
              width: 280,
              borderRightWidth: 1,
              borderRightColor: palette.border,
              padding: spacing.md,
              backgroundColor: palette.surface,
            }}
          >
            {/* Gated with the others, so the sidebar does not keep an empty
                block of padding where the destinations used to be. */}
            {signedIn ? (
              <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
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
        <View style={{ flex: 1 }}>{children}</View>
      </View>

      {/* Signed out, this would be a bordered strip with nothing in it. */}
      {layout.isCompact && signedIn ? (
        <View
          style={{
            flexDirection: 'row',
            borderTopWidth: 1,
            borderTopColor: palette.border,
          }}
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
      style={{
        flex: align === 'center' ? 1 : undefined,
        // Spec §2: touch targets keep mobile sizing at every breakpoint.
        minHeight: MIN_TOUCH_TARGET,
        justifyContent: 'center',
        paddingVertical: spacing.sm,
      }}
    >
      <Text
        style={{
          textAlign: align,
          color: item.active ? palette.accent : palette.textMuted,
          fontWeight: item.active ? '600' : '400',
        }}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

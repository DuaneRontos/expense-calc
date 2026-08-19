import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MIN_TOUCH_TARGET } from './breakpoints';
import { useLayout } from './useLayout';
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
 * **Every band gets an explicit answer for both.** The first version gave
 * bottom tabs to compact and the sidebar to expanded, and medium — every tablet
 * in portrait — silently inherited neither. A band that is not named anywhere
 * does not fall back to something sensible; its content is simply dropped.
 */

export interface NavItem {
  key: string;
  label: string;
  onPress?: () => void;
  active?: boolean;
}

export function AppShell({
  title,
  nav,
  sidebar,
  children,
}: {
  title: string;
  nav: NavItem[];
  /** Filter controls. Persistent when expanded, a collapsible drawer below it. */
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Truthiness, not `!== undefined`: #14 is likely to write
  // `sidebar={hasFilters && <Filters />}`, and `false` would otherwise put a
  // toggle on screen that opens an empty panel.
  const showsDrawer = !layout.isExpanded && Boolean(sidebar);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background, paddingTop: insets.top }}>
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
          {layout.isMedium ? (
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, flex: 1 }}>
              {nav.map((item) => (
                <NavButton key={item.key} item={item} />
              ))}
            </View>
          ) : null}

          {showsDrawer ? (
            <Pressable
              accessibilityRole="button"
              // `expanded` is honoured by TalkBack and by RNW's `aria-expanded`,
              // but it is the weakest of the iOS states and VoiceOver may drop
              // it — so the label carries the action too. The redundancy is the
              // fix, not a smell.
              accessibilityState={{ expanded: drawerOpen }}
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
        </View>
      </View>

      {/*
        The collapsible drawer of spec §2. Rendered inline above the content
        rather than as an overlay: an overlay needs focus trapping and a
        scrim to be correct, and #14 owns the real filter UI. What matters
        here is that the panel is reachable at all — it used to be dropped.
      */}
      {showsDrawer && drawerOpen ? (
        <View
          // Announces the panel's arrival on Android and web. Landing on the
          // toggle tells a screen-reader user its state; nothing otherwise
          // tells them content appeared elsewhere on the screen. #14 can do
          // real focus management.
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
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>{sidebar}</ScrollView>
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
            <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
              {nav.map((item) => (
                <NavButton key={item.key} item={item} align="left" />
              ))}
            </View>
            {sidebar}
          </View>
        ) : null}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.lg }}
        >
          {children}
        </ScrollView>
      </View>

      {layout.isCompact ? (
        <View
          style={{
            flexDirection: 'row',
            borderTopWidth: 1,
            borderTopColor: palette.border,
            paddingBottom: insets.bottom,
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

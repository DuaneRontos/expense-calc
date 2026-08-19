import { useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
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

  const showsDrawer = !layout.isExpanded && sidebar !== undefined;

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
            <Text
              accessibilityRole="button"
              accessibilityState={{ expanded: drawerOpen }}
              accessibilityLabel={drawerOpen ? 'Hide filters' : 'Show filters'}
              onPress={() => setDrawerOpen((open) => !open)}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                paddingTop: spacing.md,
                color: palette.accent,
                fontWeight: '600',
              }}
            >
              {drawerOpen ? 'Hide filters' : 'Filters'}
            </Text>
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
          style={{
            padding: spacing.md,
            backgroundColor: palette.surface,
            borderBottomWidth: 1,
            borderBottomColor: palette.border,
          }}
        >
          {sidebar}
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

function NavButton({ item, align = 'center' }: { item: NavItem; align?: 'center' | 'left' }) {
  return (
    <Text
      accessibilityRole="button"
      accessibilityState={{ selected: item.active }}
      onPress={item.onPress}
      style={{
        flex: align === 'center' ? 1 : undefined,
        textAlign: align,
        // Spec §2: touch targets keep mobile sizing at every breakpoint.
        minHeight: MIN_TOUCH_TARGET,
        paddingVertical: spacing.md,
        color: item.active ? palette.accent : palette.textMuted,
        fontWeight: item.active ? '600' : '400',
      }}
    >
      {item.label}
    </Text>
  );
}

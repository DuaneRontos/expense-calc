import { type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MIN_TOUCH_TARGET } from './breakpoints';
import { useLayout } from './useLayout';
import { palette, spacing } from '../theme/tokens';

/**
 * The one layout system of spec §2, expressed as a single component.
 *
 * Three breakpoints, one tree. The navigation moves — bottom tabs when compact,
 * a persistent sidebar when expanded — but the content is the same children in
 * all three, which is what keeps iOS, Android and desktop web from drifting
 * into three different apps.
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
  /** Filter controls. A drawer when medium, always-visible when expanded. */
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  const layout = useLayout();
  const insets = useSafeAreaInsets();

  const content = (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.lg }}
    >
      {children}
    </ScrollView>
  );

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

        {/*
          The medium band's navigation.

          Bottom tabs belong to compact and the sidebar belongs to expanded,
          which leaves 600–1024px — every tablet in portrait — with no way to
          change screen at all. Each band needs its own answer rather than two
          bands having one and the third inheriting nothing.
        */}
        {layout.isMedium ? (
          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
            {nav.map((item) => (
              <NavButton key={item.key} item={item} />
            ))}
          </View>
        ) : null}
      </View>

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

        {content}
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

import { View, type ViewProps } from 'react-native';

import { cn } from './cn';
import { Text, TextClassContext, type TextProps } from './Text';

/**
 * shadcn's Card, split into the same parts, on React Native primitives.
 *
 * The parts exist so a card's regions are named rather than reconstructed from
 * padding at each call site — that is what keeps two cards in different screens
 * looking like the same component.
 *
 * No shadow. shadcn leans on a CSS box-shadow, which has no single
 * cross-platform equivalent here: iOS takes `shadow*` props, Android takes
 * `elevation`, and web takes the CSS. The border carries the separation
 * instead, which also survives on a dark surface — see #120 before adding one.
 */
export function Card({ className, ...props }: ViewProps & { className?: string }) {
  return (
    <View
      className={cn('rounded-lg border border-border bg-background', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ViewProps & { className?: string }) {
  return <View className={cn('gap-1 p-4', className)} {...props} />;
}

/**
 * The card's heading.
 *
 * `accessibilityRole="header"` rather than styling alone: a screen reader user
 * navigating by heading should find a card the same way a sighted user finds it
 * by scanning. Maps on all three targets.
 */
export function CardTitle({ className, ...props }: TextProps) {
  return (
    <Text
      accessibilityRole="header"
      className={cn('text-base font-semibold text-text', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: TextProps) {
  return <Text className={cn('text-sm text-textMuted', className)} {...props} />;
}

/**
 * The card body.
 *
 * Publishes muted body text through `TextClassContext` so ordinary prose inside
 * a card does not have to restate it, in the same way `Button` styles its
 * label. `pt-0` because `CardHeader` already spaced the top.
 *
 * **It has to publish something `Text` does not already carry.** This said
 * `text-text` at first, which is `Text`'s own base class — so the provider was
 * a no-op, and the test named for it passed with the provider deleted
 * entirely. A figure inside a card is the emphasis; the prose around it is
 * secondary, which is what `text-textMuted` says.
 */
export function CardContent({ className, ...props }: ViewProps & { className?: string }) {
  return (
    <TextClassContext.Provider value="text-textMuted">
      <View className={cn('p-4 pt-0', className)} {...props} />
    </TextClassContext.Provider>
  );
}

export function CardFooter({ className, ...props }: ViewProps & { className?: string }) {
  return <View className={cn('flex-row items-center gap-2 p-4 pt-0', className)} {...props} />;
}

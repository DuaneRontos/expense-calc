import { Text, type TextProps } from './Text';
import { cn } from './cn';

/**
 * The visible caption above a field.
 *
 * **It is not wired to the input, and cannot be — on iOS.** On the web shadcn's
 * `Label` carries `htmlFor` and the browser does the association.
 *
 * `aria-labelledby` *is* mapped on native, contrary to what this comment said
 * first: `TextInput` reads it at
 * `Libraries/Components/TextInput/TextInput.js:729` and forwards it as
 * `accessibilityLabelledBy`. But that prop is **Android-only** and needs a
 * `nativeID` on the label to point at; iOS has no equivalent at all. So it
 * would buy one platform an association the other still lacks, at the cost of
 * an id to keep in sync.
 *
 * `accessibilityLabel` on the input is the only wiring that works on all three,
 * which is why `FormField` passes `label` to both. Presentation here, the
 * accessible name there.
 *
 * That means this is presentation only. Anything a screen reader needs to hear
 * has to be on the input as well as here.
 */
export function Label({ className, ...props }: TextProps) {
  // `text-[12px]`, not `text-xs`. Tailwind's `xs` is
  // `["0.75rem", { lineHeight: "1rem" }]`, so it emits a 16px line height as
  // well — where `style={{ fontSize: 12 }}` left that to the platform. Same
  // reasoning as `FormMessage`'s 11, one property over, and the sort of change
  // that arrives through the primitive rather than through a decision.
  return <Text className={cn('text-[12px] text-textMuted', className)} {...props} />;
}

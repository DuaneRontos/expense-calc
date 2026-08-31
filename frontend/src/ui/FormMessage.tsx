import { Text, type TextProps } from './Text';
import { cn } from './cn';

/**
 * The line under a field: its error, or its hint when there is no error.
 *
 * **It sits against the field, not in a banner** (spec §8). A 400 from this API
 * carries `violations` naming the offending field, so pooling messages into a
 * toast throws away the part the server went to trouble to provide — and leaves
 * the user to work out which of five inputs it meant.
 *
 * Presentation only, like {@link Label}: this text is *also* passed to the
 * input as `accessibilityHint`, because a screen reader user who has focused
 * the field should not have to go looking for a red line below it to find out
 * why it was rejected.
 */
export function FormMessage({
  className,
  tone = 'hint',
  ...props
}: TextProps & { tone?: 'hint' | 'error' }) {
  return (
    <Text
      // `text-[11px]`, not `text-xs`. The hand-rolled version was 11 and
      // Tailwind's `xs` is 12 — a one-pixel change nobody asked for is still a
      // change, and this is the size that already fits under a field.
      className={cn(
        'text-[11px]',
        tone === 'error' ? 'text-negative' : 'text-textMuted',
        className,
      )}
      {...props}
    />
  );
}

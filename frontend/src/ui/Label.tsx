import { Text, type TextProps } from './Text';
import { cn } from './cn';

/**
 * The visible caption above a field.
 *
 * **It is not wired to the input, and cannot be.** On the web shadcn's `Label`
 * carries `htmlFor` and the browser does the association; React Native has no
 * equivalent, and the two spellings that look like one diverge —
 * `aria-labelledby` is unmapped on native, and `nativeID` reaches the DOM but
 * not the native accessibility tree. So the association is made by giving the
 * input an `accessibilityLabel` with the same string, which is what
 * `FormField` does and why `label` is passed to both.
 *
 * That means this is presentation only. Anything a screen reader needs to hear
 * has to be on the input as well as here.
 */
export function Label({ className, ...props }: TextProps) {
  return <Text className={cn('text-xs text-textMuted', className)} {...props} />;
}

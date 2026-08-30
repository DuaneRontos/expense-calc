import { Slot } from '@rn-primitives/slot';
import { createContext, useContext } from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { cn } from './cn';

/**
 * The class string a surrounding component wants its text children to carry.
 *
 * **This is the piece web shadcn does not need.** On the web a `<button>` sets
 * a colour and the text inside inherits it, so shadcn's Button styles itself
 * and nothing else. React Native has no such inheritance: a `<Text>` inside a
 * styled `<Pressable>` inherits nothing, so a Button that sets its background
 * to `accent` gets black text on blue until something explicitly styles the
 * label.
 *
 * The alternative is making every caller write the paired text classes
 * themselves — `<Button><Text className="text-white …">` — which is exactly
 * the boilerplate the component exists to remove, and which silently drifts the
 * first time a variant's background changes.
 *
 * So the container publishes what its text should look like and `Text` reads
 * it. Callers still override by passing `className`, because the context value
 * is merged *before* theirs.
 */
export const TextClassContext = createContext<string | undefined>(undefined);

export type TextProps = RNTextProps & {
  className?: string;
  /**
   * Renders the child element instead of a `Text`, handing it these props.
   *
   * The case this exists for is `CardTitle`, which carries
   * `accessibilityRole="header"`: without it,
   * `<CardTitle asChild><Link>October</Link></CardTitle>` puts the heading role
   * on a wrapper and leaves the link as an unlabelled child, so heading
   * navigation lands next to the control rather than on it.
   *
   * **`asChild` does not get `cn`'s conflict resolution.**
   * `@rn-primitives/slot` joins `className` strings rather than merging them,
   * so the child's classes and these are both emitted and stylesheet order
   * decides. Pass one or the other, not competing values for the same property.
   *
   * A plain-string child renders **nothing**: `Slot` returns `null` for text
   * children. `<Text asChild>Save</Text>` typechecks and disappears.
   */
  asChild?: boolean;
};

export function Text({ className, asChild = false, ...props }: TextProps) {
  const inherited = useContext(TextClassContext);
  // Generic `Slot`; the per-element exports were deprecated in
  // @rn-primitives/slot 1.5.
  const Component = asChild ? Slot<typeof RNText> : RNText;

  return (
    <Component
      // Inherited first, caller's last: `cn` resolves a conflict in favour of
      // whatever arrives later, so a caller's `text-negative` beats a Button's
      // `text-background` rather than depending on class order.
      className={cn('text-text text-base', inherited, className)}
      {...props}
    />
  );
}

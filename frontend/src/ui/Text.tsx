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
   * Present for parity with the other primitives; `Text` rarely needs it, but a
   * caller wrapping text in a link or a pressable does.
   */
  asChild?: boolean;
};

export function Text({ className, ...props }: TextProps) {
  const inherited = useContext(TextClassContext);

  return (
    <RNText
      // Inherited first, caller's last: `cn` resolves a conflict in favour of
      // whatever arrives later, so a caller's `text-negative` beats a Button's
      // `text-background` rather than depending on class order.
      className={cn('text-text text-base', inherited, className)}
      {...props}
    />
  );
}

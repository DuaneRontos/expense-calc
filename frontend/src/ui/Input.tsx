import { TextInput, type TextInputProps } from 'react-native';

import { palette } from '../theme/tokens';
import { cn } from './cn';

export type InputProps = TextInputProps & {
  className?: string;
  /**
   * Draws the field as rejected.
   *
   * A boolean rather than the message itself: the message belongs under the
   * field ({@link FormMessage}) *and* on the input as `accessibilityHint`, and
   * threading it through here as well would give a third place for the three
   * to disagree.
   */
  invalid?: boolean;
};

/**
 * shadcn's `Input`, on React Native's `TextInput`.
 *
 * **`placeholderTextColor` stays a prop, not a class.** NativeWind has no
 * `placeholder:` variant that reaches this — the colour is a first-class
 * `TextInput` prop on native, with no style hook behind it — so it is read from
 * `tokens.ts` directly. That is the one colour in this file not carried by a
 * class, and it is the same token `text-textMuted` compiles to.
 *
 * **`editable` drives the disabled look, not `disabled`.** `TextInput` has no
 * `disabled` prop, so NativeWind's `disabled:` variant never matches here and
 * the muted-on-surface treatment is written as a conditional class instead.
 * Getting this wrong is silent: the classes simply never apply.
 */
export function Input({
  className,
  invalid = false,
  editable = true,
  multiline,
  ...props
}: InputProps) {
  return (
    <TextInput
      // Never on by default. Every field in this app is a name, an amount, a
      // date or a credential, and autocorrect on any of those is a nuisance at
      // best — the amount field's `numbers-and-punctuation` keyboard has been
      // known to "correct" a decimal point.
      autoCorrect={false}
      editable={editable}
      multiline={multiline}
      placeholderTextColor={palette.textMuted}
      className={cn(
        'flex-1 rounded-md border px-2',
        multiline ? 'min-h-touch-2 py-2' : 'min-h-touch py-0',
        invalid ? 'border-negative' : 'border-border',
        editable ? 'bg-background text-text' : 'bg-surface text-textMuted',
        className,
      )}
      {...props}
    />
  );
}

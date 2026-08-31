import { TextInput, type TextInputProps } from 'react-native';

import { palette } from '../theme/tokens';
import { cn } from './cn';

export type InputProps = TextInputProps & {
  className?: string;
  /**
   * Draws the field as rejected.
   *
   * A boolean rather than the message itself: the message belongs under the
   * field — see `FormMessage` — *and* on the input as `accessibilityHint`, and
   * threading it through here as well would give a third place for the three
   * to disagree. (`FormMessage` renders it; this only draws the border.)
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
  readOnly,
  multiline,
  accessibilityState,
  ...props
}: InputProps) {
  /**
   * One source for "can this be typed in", because `TextInput` has two.
   *
   * `InputProps` advertises the whole `TextInputProps` surface, which includes
   * `readOnly`, and RN resolves the pair itself:
   * `editable={readOnly !== undefined ? !readOnly : editable}`
   * (`TextInput.js:928`). So `<Input readOnly />` was genuinely uneditable
   * while this component's own `editable` stayed at its `true` default — the
   * field rendered `bg-background text-text` and looked perfectly editable.
   * Deriving both from one value is what stops the look and the behaviour
   * disagreeing.
   */
  const isEditable = readOnly !== undefined ? !readOnly : editable;

  return (
    <TextInput
      // Never on by default. Every field in this app is a name, an amount, a
      // date or a credential, and autocorrect on any of those is a nuisance at
      // best — the amount field's `numbers-and-punctuation` keyboard has been
      // known to "correct" a decimal point.
      autoCorrect={false}
      /**
       * **`editable` does not reach the accessibility tree, so this does.**
       *
       * `TextInput` builds its `_accessibilityState` from `accessibilityState`
       * and the `aria-*` props only (`TextInput.js:634-650`); `editable` is
       * never consulted. So on iOS and Android a locked field announced as an
       * ordinary editable one, with the state carried by colour alone. The live
       * case is the sign-in screen, whose fields go `editable={!submitting}` —
       * during a submit, VoiceOver and TalkBack said they were still editable.
       *
       * Web was already fine: react-native-web emits the `readOnly` attribute.
       * Pre-existing rather than introduced here, but this is now the one place
       * that knows what "disabled" means for an input.
       *
       * Merged, so a caller's own state extends rather than replaces it.
       */
      accessibilityState={{ disabled: !isEditable, ...accessibilityState }}
      editable={isEditable}
      multiline={multiline}
      placeholderTextColor={palette.textMuted}
      className={cn(
        'flex-1 rounded-md border px-2',
        multiline ? 'min-h-touch-2 py-2' : 'min-h-touch py-0',
        invalid ? 'border-negative' : 'border-border',
        isEditable ? 'bg-background text-text' : 'bg-surface text-textMuted',
        className,
      )}
      {...props}
    />
  );
}

import { type ReactNode } from 'react';
import { Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { MIN_TOUCH_TARGET } from '../layout/breakpoints';
import { palette, spacing } from '../theme/tokens';

/**
 * One labelled input with its error message underneath.
 *
 * **The message sits against the field, not in a banner.** Spec §8 asks for
 * that specifically, and the API is built for it: a 400 carries `violations`
 * naming the offending field, so a form that pooled them into a toast would be
 * throwing away the part the server went to trouble to provide.
 */
export function FormField({
  label,
  value,
  onChangeText,
  error,
  hint,
  placeholder,
  keyboardType,
  autoCapitalize = 'sentences',
  multiline,
  editable = true,
  accessory,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** From local validation or from the server; the field cannot tell which. */
  error?: string;
  hint?: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  multiline?: boolean;
  editable?: boolean;
  accessory?: ReactNode;
  /**
   * Masks the value, for the one field in the app that carries a credential.
   *
   * Passed through rather than left to a caller rendering its own `TextInput`:
   * the alternative is a second input in the app that has to re-derive this
   * component's label wiring, error placement and touch target, and the field
   * most worth getting right is a poor one to make the exception.
   */
  secureTextEntry?: boolean;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: palette.textMuted, fontSize: 12 }}>{label}</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {accessory}
        <TextInput
          accessibilityLabel={label}
          // Announces the error with the field rather than leaving a screen
          // reader to find a red line somewhere below it.
          accessibilityHint={error ?? hint}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.textMuted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          multiline={multiline}
          editable={editable}
          secureTextEntry={secureTextEntry}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: error ? palette.negative : palette.border,
            borderRadius: 6,
            paddingHorizontal: spacing.sm,
            paddingVertical: multiline ? spacing.sm : 0,
            minHeight: multiline ? MIN_TOUCH_TARGET * 2 : MIN_TOUCH_TARGET,
            color: editable ? palette.text : palette.textMuted,
            backgroundColor: editable ? palette.background : palette.surface,
          }}
        />
      </View>

      {error ? (
        <Text style={{ color: palette.negative, fontSize: 11 }}>{error}</Text>
      ) : hint ? (
        <Text style={{ color: palette.textMuted, fontSize: 11 }}>{hint}</Text>
      ) : null}
    </View>
  );
}

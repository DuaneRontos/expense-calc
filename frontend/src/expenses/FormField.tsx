import { type ReactNode } from 'react';
import { View, type KeyboardTypeOptions } from 'react-native';

import { FormMessage, Input, Label } from '../ui';

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
    <View className="gap-1">
      {/*
        Presentation only. `Label` cannot be wired to the input the way a web
        `<label htmlFor>` is: `aria-labelledby` does reach native, but only as
        Android's `accessibilityLabelledBy`, and iOS has no equivalent. So the
        same string goes to the input as `accessibilityLabel` below. Both,
        deliberately — see `Label` for the full reasoning.
      */}
      <Label>{label}</Label>

      <View className="flex-row items-center gap-2">
        {accessory}
        <Input
          accessibilityLabel={label}
          // Announces the error with the field rather than leaving a screen
          // reader to find a red line somewhere below it.
          accessibilityHint={error ?? hint}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          multiline={multiline}
          editable={editable}
          secureTextEntry={secureTextEntry}
          invalid={!!error}
        />
      </View>

      {error ? (
        <FormMessage tone="error">{error}</FormMessage>
      ) : hint ? (
        <FormMessage>{hint}</FormMessage>
      ) : null}
    </View>
  );
}

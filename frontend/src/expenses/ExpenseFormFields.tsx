import { Text, View } from 'react-native';

import { FormField } from './FormField';
import { CURRENCY, type ExpenseFormValues, type FieldErrors } from './expenseFormRules';
import { palette, spacing } from '../theme/tokens';

/**
 * The four fields the API accepts on an expense (spec §4).
 *
 * **No category field, and that is the API's shape rather than an omission.**
 * `POST /expenses` and `PATCH /expenses/{id}` take no category: the rule engine
 * assigns one, and changing it is a separate append-only reclassification that
 * requires a reason (spec §4). A picker here would have to invent that reason or
 * silently discard the history the endpoint exists to keep.
 */
export function ExpenseFormFields({
  values,
  errors,
  onChange,
}: {
  values: ExpenseFormValues;
  errors: FieldErrors;
  onChange: (patch: Partial<ExpenseFormValues>) => void;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <FormField
        label="Amount"
        value={values.amount}
        onChangeText={(amount) => onChange({ amount })}
        error={errors.amount}
        placeholder="1234.56"
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        hint="Negative for a refund, which keeps the category of what it refunds."
        accessory={
          // The currency is shown, not chosen. v1 is PHP only and anything else
          // is a 400 before it reaches the database, so a picker would offer
          // choices the server rejects.
          <View
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.xs,
              borderRadius: 6,
              backgroundColor: palette.surface,
            }}
          >
            <Text style={{ color: palette.textMuted, fontVariant: ['tabular-nums'] }}>
              {CURRENCY}
            </Text>
          </View>
        }
      />

      <FormField
        label="Date"
        value={values.occurredOn}
        onChangeText={(occurredOn) => onChange({ occurredOn })}
        error={errors.occurredOn}
        placeholder="2026-08-23"
        autoCapitalize="none"
        hint="The day the money moved, not the day it was recorded."
      />

      <FormField
        label="Merchant"
        value={values.merchant}
        onChangeText={(merchant) => onChange({ merchant })}
        error={errors.merchant}
        placeholder="SM Supermarket"
        hint="Classification reads this first, then the description."
      />

      <FormField
        label="Description"
        value={values.description}
        onChangeText={(description) => onChange({ description })}
        error={errors.description}
        placeholder="Weekly groceries"
        multiline
      />
    </View>
  );
}

import { memo } from 'react';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { formatMoney, isNegative } from '../money/format';
import { colorForCategory, palette, spacing } from '../theme/tokens';
import type { ExpenseSummary } from '../api/types';

/**
 * One row of the expense list.
 *
 * Memoized because a list re-renders on every page append and every filter
 * change, and the rows already on screen have not changed.
 */
function ExpenseRowComponent({ expense }: { expense: ExpenseSummary }) {
  const negative = isNegative(expense.amount);
  const amount = formatMoney(expense.amount);

  return (
    <Pressable
      // One label for the row, so a screen reader reads it as a record rather
      // than stopping between five fragments.
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${expense.merchant ?? 'No merchant'}, ${amount}, ${expense.categoryLabel}, ${expense.occurredOn}`}
      accessibilityHint="Opens this expense"
      onPress={() => router.push({ pathname: '/expenses/[id]', params: { id: expense.id } })}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: palette.border,
      }}
    >
      <View
        aria-hidden
        style={{
          width: 4,
          alignSelf: 'stretch',
          borderRadius: 2,
          backgroundColor: colorForCategory(expense.category),
        }}
      />

      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: palette.text, fontWeight: '500' }} numberOfLines={1}>
          {expense.merchant ?? 'No merchant'}
        </Text>
        <Text style={{ color: palette.textMuted, fontSize: 12 }} numberOfLines={1}>
          {expense.categoryLabel} · {expense.occurredOn}
        </Text>
        {expense.description ? (
          <Text style={{ color: palette.textMuted, fontSize: 12 }} numberOfLines={1}>
            {expense.description}
          </Text>
        ) : null}
      </View>

      <Text
        style={{
          color: negative ? palette.negative : palette.text,
          fontWeight: '600',
          fontVariant: ['tabular-nums'],
        }}
      >
        {amount}
      </Text>
    </Pressable>
  );
}

export const ExpenseRow = memo(ExpenseRowComponent);

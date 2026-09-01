import { memo } from 'react';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { formatMoney, isNegative } from '../money/format';
import { colorForCategory } from '../theme/tokens';
import { Text } from '../ui/Text';
import { cn } from '../ui/cn';
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
      // than stopping between five fragments. The *label* is what does that;
      // `accessible` below is `Pressable`'s own default
      // (`accessible: accessible !== false`) and is written out only because
      // this row depends on it — deleting it changes nothing, which is worth
      // knowing before someone "cleans it up" and assumes they have tested the
      // grouping.
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${expense.merchant ?? 'No merchant'}, ${amount}, ${expense.categoryLabel}, ${expense.occurredOn}`}
      accessibilityHint="Opens this expense"
      onPress={() => router.push({ pathname: '/expenses/[id]', params: { id: expense.id } })}
      className="flex-row items-center gap-2 border-b border-border py-2"
    >
      {/*
        The category stripe. `colorForCategory` stays a runtime value rather
        than a class: the category comes from the server, so there is no class
        name to write ahead of time, and this is the same lookup the chart
        legend uses. Decorative — the label below says the category in words
        (spec §10).
      */}
      <View
        aria-hidden
        className="w-1 self-stretch rounded-sm"
        style={{ backgroundColor: colorForCategory(expense.category) }}
      />

      <View className="flex-1 gap-0.5">
        {/*
          `text-sm` = 14, which is what these lines were: the old styles set
          colour and weight and no `fontSize`, so they took react-native-web's
          base of 14. `ui/Text` defaults to `text-base` = 16, so migrating
          without saying so grew every line in the row by a step — the same
          silent growth #113 had to undo.
        */}
        <Text className="text-sm font-medium text-text" numberOfLines={1}>
          {expense.merchant ?? 'No merchant'}
        </Text>
        <Text className="text-xs text-textMuted" numberOfLines={1}>
          {expense.categoryLabel} · {expense.occurredOn}
        </Text>
        {expense.description ? (
          <Text className="text-xs text-textMuted" numberOfLines={1}>
            {expense.description}
          </Text>
        ) : null}
      </View>

      {/*
        `tabular-nums` stays a style prop: NativeWind has no `font-variant`
        utility, and without it the amounts jitter column-to-column as digits
        change width. Colour marks a refund, but it is not the only signal —
        `formatMoney` keeps the minus sign in the text (spec §10, and the
        signed-amount rule in CLAUDE.md).
      */}
      <Text
        className={cn('text-sm font-semibold', negative ? 'text-negative' : 'text-text')}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {amount}
      </Text>
    </Pressable>
  );
}

export const ExpenseRow = memo(ExpenseRowComponent);

import { Pressable, Text, View } from 'react-native';

import { useExpenseQuery, DEFAULT_SORT } from './ExpenseQueryProvider';
import { MIN_TOUCH_TARGET } from '../layout/breakpoints';
import { palette, spacing } from '../theme/tokens';
import type { ExpenseSortField } from '../api/types';

/**
 * Sort controls, limited to the fields the server actually sorts on (spec §6).
 *
 * A closed set, and it has to be: `ORDER BY` cannot take a bound parameter, so
 * the server accepts only these four names and 400s on anything else. Offering
 * a fifth here would produce an error the user could not act on.
 *
 * `amountMinor` is spelled as the spec spells it. The server accepts `amount`
 * too and sorts on the stored integer either way — the parameter names a column
 * rather than a unit.
 */
const FIELDS: { field: ExpenseSortField; label: string }[] = [
  { field: 'occurredOn', label: 'Date' },
  { field: 'amountMinor', label: 'Amount' },
  { field: 'merchant', label: 'Merchant' },
  { field: 'category', label: 'Category' },
];

export function SortControl() {
  const { query, setSort } = useExpenseQuery();
  const active = query.sort ?? DEFAULT_SORT;

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ color: palette.textMuted, fontSize: 12 }}>Sort by</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {FIELDS.map(({ field, label }) => {
          const selected = active.field === field;
          const direction = selected && active.direction === 'asc' ? 'asc' : 'desc';

          return (
            <Pressable
              key={field}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={
                selected
                  ? `Sorted by ${label}, ${direction === 'asc' ? 'ascending' : 'descending'}. Activate to reverse.`
                  : `Sort by ${label}`
              }
              // Selecting a new field starts descending — the default the server
              // applies and the one a person means by "sort by amount". Tapping
              // the active field reverses it.
              onPress={() =>
                setSort({
                  field,
                  direction: selected && active.direction === 'desc' ? 'asc' : 'desc',
                })
              }
              style={{
                minHeight: MIN_TOUCH_TARGET,
                justifyContent: 'center',
                paddingHorizontal: spacing.sm,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: selected ? palette.accent : palette.border,
                backgroundColor: selected ? '#EAF1FE' : palette.background,
              }}
            >
              <Text style={{ color: selected ? palette.accent : palette.text, fontSize: 13 }}>
                {label}
                {selected ? (active.direction === 'asc' ? ' ↑' : ' ↓') : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';

import { useCategories } from './useCategories';
import { useDebounced } from './useDebounced';
import { useExpenseQuery } from './ExpenseQueryProvider';
import { assertSendableAmount } from '../money/format';
import { MIN_TOUCH_TARGET } from '../layout/breakpoints';
import { colorForCategory, palette, spacing } from '../theme/tokens';
import { needsSignIn } from '../api/problem';

/**
 * The filter controls of spec §2 and issue #14.
 *
 * **Every control here composes a query parameter.** Nothing filters a list in
 * the client — the server owns filtering, and the list renders what comes back.
 * That is why an invalid amount is refused here rather than quietly dropped:
 * the alternative is a filter the user set and the server never saw.
 */
export function ExpenseFilters() {
  const { query, setFilters, toggleCategory, clear, activeFilterCount, generation } =
    useExpenseQuery();
  const { categories, error: categoriesError, retry: retryCategories } = useCategories();

  return (
    // Keyed on the clear generation so every input below remounts empty when
    // the query is reset from anywhere. Cheaper and less surprising than each
    // field watching the query and resetting itself.
    <View key={generation} style={{ gap: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '600', color: palette.text }}>
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </Text>
        {activeFilterCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            onPress={clear}
            style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
          >
            <Text style={{ color: palette.accent }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: palette.textMuted, fontSize: 12 }}>Category</Text>
        {categoriesError ? (
          <View style={{ gap: spacing.xs }}>
            <Text style={{ color: palette.textMuted, fontSize: 12 }}>
              Categories could not be loaded.
            </Text>
            {/*
              No retry against a refused credential: it reproduces the identical
              refusal. The message stays — it is still true — but the list's own
              failure card is what offers the way in, and a second sign-in link
              here would sit right beside it.
            */}
            {needsSignIn(categoriesError) ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading categories"
                onPress={retryCategories}
                style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
              >
                <Text style={{ color: palette.accent }}>Try again</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        <View
          // Grouped and named so the checkboxes are announced as one set,
          // the same intent as the reclassify radios. These are multi-select,
          // so `radiogroup` would misdescribe them, and RN's
          // `accessibilityRole` union has no `group` member — hence the `role`
          // prop, which the types do accept.
          //
          // **Web-only, and more so than the radio groups.** RNW forwards
          // `role` to the DOM, but Android's `fromRole()` has no `Role.GROUP`
          // case and drops it outright, and iOS has no matching trait. The two
          // props reach opposite platforms: RNW deprecates `accessibilityRole`
          // in favour of `role`, while native maps `accessibilityRole` and
          // ignores `role="group"`. Which is why the children below stay on
          // `accessibilityRole` — `checkbox` and `radio` map on all three
          // targets, so following the deprecation down there would cost native
          // and buy nothing. Nothing here changes on a phone.
          //
          // The name repeats the heading above; kept for the reason spelled
          // out in ReclassifyControl — on web a stutter beats an unnamed
          // group, and native is unaffected either way.
          role="group"
          accessibilityLabel="Category"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}
        >
          {categories.map((category) => {
            const selected = query.category?.includes(category.key) ?? false;
            return (
              <Pressable
                key={category.key}
                accessibilityRole="checkbox"
                // `aria-checked` for the reason given on the radios in
                // PeriodPicker: `accessibilityState` never reaches the DOM
                // under RNW, and RN merges the flat prop back into
                // `accessibilityState` on native, so this is the one form that
                // works everywhere.
                aria-checked={selected}
                accessibilityLabel={category.label}
                onPress={() => toggleCategory(category.key)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.xs,
                  minHeight: MIN_TOUCH_TARGET,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.xs,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? palette.accent : palette.border,
                  backgroundColor: selected ? '#EAF1FE' : palette.background,
                }}
              >
                {/* Colour repeats the chart legend's, but the label is what
                    carries the meaning here too (spec §10). */}
                <View
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: colorForCategory(category.key),
                  }}
                />
                <Text style={{ color: selected ? palette.accent : palette.text, fontSize: 13 }}>
                  {category.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {(query.category?.length ?? 0) > 1 ? (
          <Text style={{ color: palette.textMuted, fontSize: 11 }}>
            Matching any of {query.category?.length} categories.
          </Text>
        ) : null}
      </View>

      <TextFilter
        label="Merchant"
        value={query.merchant ?? ''}
        onCommit={(merchant) => setFilters({ merchant: merchant || undefined })}
        placeholder="SM Supermarket"
      />

      <TextFilter
        label="Description contains"
        value={query.q ?? ''}
        onCommit={(q) => setFilters({ q: q || undefined })}
        placeholder="groceries"
      />

      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: palette.textMuted, fontSize: 12 }}>Date range</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <DateFilter
            label="From"
            value={query.from ?? ''}
            onCommit={(from) => setFilters({ from: from || undefined })}
          />
          <DateFilter
            label="To"
            value={query.to ?? ''}
            onCommit={(to) => setFilters({ to: to || undefined })}
          />
        </View>
        {/* Half-open is not a detail (spec §6): [Jan 1, Feb 1) is January with
            no chance of the boundary day counting twice. */}
        <Text style={{ color: palette.textMuted, fontSize: 11 }}>
          To is exclusive — use 1 September for all of August.
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: palette.textMuted, fontSize: 12 }}>Amount range</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <AmountFilter
            label="Min"
            value={query.minAmount ?? ''}
            onCommit={(minAmount) => setFilters({ minAmount: minAmount || undefined })}
          />
          <AmountFilter
            label="Max"
            value={query.maxAmount ?? ''}
            onCommit={(maxAmount) => setFilters({ maxAmount: maxAmount || undefined })}
          />
        </View>
        {/* Signed, so a minimum of zero excludes refunds rather than including
            them by magnitude (spec §6). */}
        <Text style={{ color: palette.textMuted, fontSize: 11 }}>
          Compared against the signed amount, so a minimum of 0 hides refunds.
        </Text>
      </View>
    </View>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: palette.border,
  borderRadius: 6,
  paddingHorizontal: spacing.sm,
  minHeight: MIN_TOUCH_TARGET,
  color: palette.text,
  backgroundColor: palette.background,
} as const;

/** A text filter that settles before it asks the server anything. */
function TextFilter({
  label,
  value,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const settled = useDebounced(draft.trim());

  useEffect(() => {
    if (settled !== value) {
      onCommit(settled);
    }
    // Committing is the effect; re-running on `onCommit` identity would fire it
    // again on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  return (
    <View style={{ flex: 1, gap: spacing.xs }}>
      <Text style={{ color: palette.textMuted, fontSize: 12 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={draft}
        onChangeText={setDraft}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={inputStyle}
      />
    </View>
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An ISO date bound, refused locally rather than sent as a 400. */
function DateFilter({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  return (
    <ValidatedFilter
      label={label}
      value={value}
      onCommit={onCommit}
      placeholder="2026-08-01"
      validate={(text) => (ISO_DATE.test(text) ? null : 'Use YYYY-MM-DD.')}
    />
  );
}

/**
 * An amount bound, validated by the same rule the write path uses.
 *
 * The server runs these through the same conversion as a posted amount and
 * rejects sub-centavo precision, so catching it here makes a typo a field
 * message instead of a round trip.
 */
function AmountFilter({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  return (
    <ValidatedFilter
      label={label}
      value={value}
      onCommit={onCommit}
      placeholder="0.00"
      // iOS's `numeric` pad has no minus key, and a negative bound is a
      // supported query — `maxAmount=-0.01` is "show me only refunds". Android
      // and web accept one either way.
      keyboardType={Platform.select({ ios: 'numbers-and-punctuation', default: 'numeric' })}
      validate={(text) => {
        try {
          assertSendableAmount(text);
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : 'Not an amount.';
        }
      }}
    />
  );
}

function ValidatedFilter({
  label,
  value,
  onCommit,
  placeholder,
  validate,
  keyboardType,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  validate: (value: string) => string | null;
  keyboardType?: 'numeric' | 'numbers-and-punctuation';
}) {
  const [draft, setDraft] = useState(value);
  const settled = useDebounced(draft.trim());

  // Derived during render rather than stored in state and written from an
  // effect. `validate` is pure, so the message is a function of what is in the
  // box — keeping a second copy in state only creates a render where the two
  // disagree.
  const message = settled === '' ? null : validate(settled);

  useEffect(() => {
    // The effect does one thing: publish a settled, valid value to the shared
    // query. It does not set this component's state.
    if (settled === '') {
      if (value !== '') {
        onCommit('');
      }
      return;
    }
    if (!message && settled !== value) {
      onCommit(settled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  return (
    <View style={{ flex: 1, gap: spacing.xs }}>
      <Text style={{ color: palette.textMuted, fontSize: 12 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={draft}
        onChangeText={setDraft}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        style={[inputStyle, message ? { borderColor: palette.negative } : null]}
      />
      {/* Inline against the offending field, which is what spec §8 asks for
          when the server sends violations — same treatment before it does.

          Naming what is still applied matters as much as naming the problem:
          a rejected value commits nothing, so the previous bound stays in force
          while the box shows something else, and the control and the list
          silently disagree about which is real. */}
      {message ? (
        <Text style={{ color: palette.negative, fontSize: 11 }}>
          {message}
          {value !== '' ? ` Still filtering by ${value}.` : ''}
        </Text>
      ) : null}
    </View>
  );
}

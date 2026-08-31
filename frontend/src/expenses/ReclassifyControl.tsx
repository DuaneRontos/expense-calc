import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useCategories } from './useCategories';
import { MAX_REASON_LENGTH, type FieldErrors } from './expenseFormRules';
import { MIN_TOUCH_TARGET } from '../layout/breakpoints';
import { colorForCategory, palette, spacing } from '../theme/tokens';
import { Button } from '../ui/Button';
// Aliased: the file keeps RN's `Text` for everything that is not a button
// label. Only `ui/Text` reads `TextClassContext`, so a button label written
// with the wrong one renders unstyled and nothing warns.
import { Text as UIText } from '../ui/Text';
import type { Category } from '../api/types';
import { needsSignIn } from '../api/problem';

/**
 * Changing an expense's category (spec §4, issue #15).
 *
 * **A reclassification, not a field edit.** The category is not a column on the
 * expense — it is derived from the newest record in an append-only history, so
 * changing it appends rather than overwrites, and the API requires a non-blank
 * reason. That requirement is the point: an unexplained category change is
 * exactly the question the history exists to answer, and a form that invented
 * the reason ("changed by user") would answer it with noise.
 *
 * `UNCLASSIFIED` is offered like any other, because it is a real state rather
 * than a failure — an expense the engine could not place is a prompt for a
 * decision, and moving one back to it is a legitimate decision.
 */
export function ReclassifyControl({
  current,
  errors,
  submitting,
  onReclassify,
}: {
  current: Category;
  errors: FieldErrors;
  submitting: boolean;
  onReclassify: (category: Category, reason: string) => void;
}) {
  const { categories, error: categoriesError, retry } = useCategories();
  const [selected, setSelected] = useState<Category | null>(null);
  const [reason, setReason] = useState('');

  /**
   * Clears the draft once the category actually moved.
   *
   * **Without this the reason outlives the change it explained.** The panel
   * collapses on success — `current` now equals `target` — but the text stayed
   * in state, so the next category change in the same session opened
   * pre-filled with the previous justification and one tap from being
   * submitted. A carried-over reason is worse than a blank one: it reads as
   * deliberate, and the history exists precisely so a category is explicable
   * months later.
   */
  const previous = useRef(current);
  useEffect(() => {
    if (previous.current !== current) {
      previous.current = current;
      setSelected(null);
      setReason('');
    }
  }, [current]);

  const target = selected ?? current;
  const changed = target !== current;
  const reasonTooLong = reason.trim().length > MAX_REASON_LENGTH;
  const canSubmit = changed && reason.trim() !== '' && !reasonTooLong && !submitting;

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ color: palette.textMuted, fontSize: 12 }}>Category</Text>

      {categoriesError ? (
        <View style={{ gap: spacing.xs }}>
          <Text style={{ color: palette.textMuted, fontSize: 12 }}>
            Categories could not be loaded.
          </Text>
          {/*
            No retry against a refused credential: it reproduces the identical
            refusal. The message stays — it is still true and still worth saying
            — but the screen's own failure card is what offers the way in, and a
            second sign-in link here would sit right beside it.
          */}
          {needsSignIn(categoriesError) ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading categories"
              onPress={retry}
              style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
            >
              <Text style={{ color: palette.accent }}>Try again</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      <View
        // Grouped and named so the radios are announced as one set rather
        // than loose controls — otherwise a screen reader reads "Groceries,
        // selected" with no hint that the other categories sit beside it.
        //
        // **This lands on web only.** RNW forwards the role to the DOM; iOS
        // maps `radiogroup` to no trait at all, and Android to a role
        // description with nothing positional. Native is unchanged.
        //
        // The name repeats the visible heading above, so web says "Category"
        // twice. Kept deliberately, though the comparison is narrower than it
        // looks: `aria-labelledby` would dedupe it under RNW but is unmapped
        // on native, and since the grouping is web-only anyway, the real
        // choice is a stutter versus an unnamed group — on web, in both cases.
        // A stutter is the better half of that.
        accessibilityRole="radiogroup"
        accessibilityLabel="Category"
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}
      >
        {categories.map((category) => {
          const isTarget = category.key === target;
          return (
            <Pressable
              key={category.key}
              accessibilityRole="radio"
              // `aria-checked` plus `accessibilityState.selected`, for the
              // reasons spelled out on the identical pair in PeriodPicker: the
              // flat prop is the only one RNW forwards, and `selected` is what
              // carries the iOS trait.
              aria-checked={isTarget}
              accessibilityState={{ selected: isTarget }}
              accessibilityLabel={category.label}
              onPress={() => setSelected(category.key)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.xs,
                minHeight: MIN_TOUCH_TARGET,
                paddingHorizontal: spacing.sm,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: isTarget ? palette.accent : palette.border,
                backgroundColor: isTarget ? '#EAF1FE' : palette.background,
              }}
            >
              <View
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colorForCategory(category.key),
                }}
              />
              <Text style={{ color: isTarget ? palette.accent : palette.text, fontSize: 13 }}>
                {category.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {changed ? (
        <View style={{ gap: spacing.xs }}>
          <Text style={{ color: palette.textMuted, fontSize: 12 }}>
            Why? This is kept with the change.
          </Text>
          <TextInput
            accessibilityLabel="Reason for the category change"
            value={reason}
            onChangeText={setReason}
            placeholder="Bought for the office, not the house"
            placeholderTextColor={palette.textMuted}
            style={{
              borderWidth: 1,
              borderColor: errors.reason || reasonTooLong ? palette.negative : palette.border,
              borderRadius: 6,
              paddingHorizontal: spacing.sm,
              minHeight: MIN_TOUCH_TARGET,
              color: palette.text,
            }}
          />
          {reasonTooLong ? (
            <Text style={{ color: palette.negative, fontSize: 11 }}>
              {reason.trim().length} characters; the limit is {MAX_REASON_LENGTH}.
            </Text>
          ) : errors.reason ? (
            <Text style={{ color: palette.negative, fontSize: 11 }}>{errors.reason}</Text>
          ) : null}

          <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
            <Button
              // The state the issue calls out: a screen reader announcing an
              // enabled-sounding button that does nothing is the regression.
              // `Button` declares both spellings; `busy` is separate because
              // "cannot be pressed" and "is working" are different claims.
              busy={submitting}
              disabled={!canSubmit}
              onPress={() => onReclassify(target, reason.trim())}
            >
              <UIText>{submitting ? 'Saving…' : 'Change category'}</UIText>
            </Button>
            <Button
              variant="ghost"
              onPress={() => {
                setSelected(null);
                setReason('');
              }}
            >
              <UIText>Cancel</UIText>
            </Button>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSelected(null);
                setReason('');
              }}
              style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
            >
              <Text style={{ color: palette.textMuted }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

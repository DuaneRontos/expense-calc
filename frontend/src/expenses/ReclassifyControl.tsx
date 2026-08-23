import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useCategories } from './useCategories';
import { MAX_REASON_LENGTH, type FieldErrors } from './expenseFormRules';
import { MIN_TOUCH_TARGET } from '../layout/breakpoints';
import { colorForCategory, palette, spacing } from '../theme/tokens';
import type { Category } from '../api/types';

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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading categories"
            onPress={retry}
            style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
          >
            <Text style={{ color: palette.accent }}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      <View
        // Named as a group so each category radio is announced with its
        // position in it. Without this a screen reader reads "Groceries,
        // selected" with no hint that the other categories sit beside it.
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
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit }}
              disabled={!canSubmit}
              onPress={() => onReclassify(target, reason.trim())}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                justifyContent: 'center',
                paddingHorizontal: spacing.md,
                borderRadius: 6,
                backgroundColor: canSubmit ? palette.accent : palette.border,
              }}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
                {submitting ? 'Saving…' : 'Change category'}
              </Text>
            </Pressable>
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

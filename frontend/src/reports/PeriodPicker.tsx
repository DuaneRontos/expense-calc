import { Pressable, Text, View } from 'react-native';

import { describePeriod, PERIOD_CHOICES } from './periods';
import { MIN_TOUCH_TARGET } from '../layout/breakpoints';
import { palette, spacing } from '../theme/tokens';

/**
 * Which window the three reports describe.
 *
 * Presets only. The API takes **both bounds or neither** — it rejects one alone,
 * because "January to unspecified" reads as either "to now" or "to the end of
 * January" and guessing produces a report that is wrong without looking wrong.
 * A pair of free-text date fields would make that error easy to reach; a preset
 * cannot express it.
 */
export function PeriodPicker({
  selected,
  onSelect,
  period,
}: {
  selected: string;
  onSelect: (key: string) => void;
  period: { from: string; to: string };
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <View
        // Grouped and named so the four radios are announced as one set
        // rather than four loose controls — otherwise a screen reader reads
        // "This month, selected" with no hint that three alternatives sit
        // beside it.
        //
        // **This lands on web only.** RNW forwards the role to the DOM, where
        // a radio's position in its group is something a screen reader can
        // announce. On iOS `radiogroup` maps to `UIAccessibilityTraitNone`;
        // on Android it sets a role description ("radio group") and nothing
        // positional, because position comes from `CollectionItemInfo`, which
        // a container role does not populate. Native is unchanged, not
        // improved.
        accessibilityRole="radiogroup"
        accessibilityLabel="Reporting period"
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}
      >
        {PERIOD_CHOICES.map((choice) => {
          const active = choice.key === selected;
          return (
            <Pressable
              key={choice.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={choice.label}
              onPress={() => onSelect(choice.key)}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                justifyContent: 'center',
                paddingHorizontal: spacing.md,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: active ? palette.accent : palette.border,
                backgroundColor: active ? '#EAF1FE' : palette.background,
              }}
            >
              <Text style={{ color: active ? palette.accent : palette.text, fontSize: 13 }}>
                {choice.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Stated because half-open is not a detail: `to` is the first day *after*
          the window, so a month never bleeds into the next one. Phrased through
          `describePeriod` so every caption on the screen says it identically. */}
      <Text style={{ color: palette.textMuted, fontSize: 11 }}>{describePeriod(period)}</Text>
    </View>
  );
}

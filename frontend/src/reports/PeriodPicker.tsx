import { Text, View } from 'react-native';

import { describePeriod, PERIOD_CHOICES } from './periods';
import { palette, spacing } from '../theme/tokens';
import { Chip } from '../ui/Chip';
import { Text as UIText } from '../ui/Text';

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
            <Chip
              key={choice.key}
              shape="block"
              selected={active}
              className="px-4"
              accessibilityRole="radio"
              // `aria-checked`, not `accessibilityState.checked`, because it is
              // the only form that reaches all three targets: RNW's forwarded
              // prop list has no `accessibilityState` entry at all, so `View`
              // filters it out before it can reach the DOM, while RN merges
              // `aria-checked` back into `accessibilityState` on native
              // (View.js). ARIA also requires `checked` rather than `selected`
              // on `role="radio"`.
              //
              // `selected` stays because it is what carries
              // `UIAccessibilityTraitSelected` on iOS, and it is passed as
              // `accessibilityState` rather than `aria-selected` so that no
              // `aria-selected` — unsupported on `role="radio"` — reaches the
              // DOM.
              aria-checked={active}
              accessibilityState={{ selected: active }}
              accessibilityLabel={choice.label}
              onPress={() => onSelect(choice.key)}
            >
              {/* `px-4` above: this chip used `spacing.md`, where the sort
                  chips use `spacing.sm`. Kept rather than averaged. */}
              <UIText>{choice.label}</UIText>
            </Chip>
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

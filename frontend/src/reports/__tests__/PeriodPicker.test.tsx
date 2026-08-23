import { render, screen } from '@testing-library/react-native';

import { PeriodPicker } from '../PeriodPicker';
import { PERIOD_CHOICES, type PeriodChoice } from '../periods';

/**
 * Pins the state a period chip announces (issue #69).
 *
 * **`toBeChecked()` is the assertion with teeth, not `toBeSelected()`.** The
 * matcher reads `aria-checked ?? accessibilityState.checked`, the same pair the
 * platforms read — RNW forwards only the flat prop to the DOM, and RN merges it
 * back into `accessibilityState` on native. These chips used to carry
 * `selected` alone, so they announced identically on web whether or not they
 * were active; asserting `toBeSelected()` would have passed throughout.
 */
const PERIOD = { from: '2026-08-01', to: '2026-09-01' };

// Indexing a `PeriodChoice[]` widens to `| undefined`, and a test that silently
// skipped its subject would be worse than one that fails loudly.
const choiceAt = (index: number): PeriodChoice => {
  const choice = PERIOD_CHOICES[index];
  if (!choice) {
    throw new Error(`PERIOD_CHOICES has no entry at ${index}`);
  }
  return choice;
};

const renderPicker = (selected: string) =>
  render(<PeriodPicker selected={selected} onSelect={() => {}} period={PERIOD} />);

describe('PeriodPicker chip state', () => {
  it('marks the active choice checked and the rest unchecked', async () => {
    const active = choiceAt(0);
    await renderPicker(active.key);

    expect(screen.getByLabelText(active.label)).toBeChecked();
    for (const choice of PERIOD_CHOICES.filter((c) => c.key !== active.key)) {
      expect(screen.getByLabelText(choice.label)).not.toBeChecked();
    }
  });

  it('moves the checked state when the selection changes', async () => {
    const first = choiceAt(0);
    const second = choiceAt(1);
    const view = await renderPicker(first.key);

    await view.rerender(
      <PeriodPicker selected={second.key} onSelect={() => {}} period={PERIOD} />,
    );

    expect(screen.getByLabelText(first.label)).not.toBeChecked();
    expect(screen.getByLabelText(second.label)).toBeChecked();
  });

  it('keeps the iOS selected trait alongside it', async () => {
    const active = choiceAt(0);
    await renderPicker(active.key);

    // `selected` is what carries `UIAccessibilityTraitSelected`; `aria-checked`
    // does not, so dropping it would cost iOS the only state it conveys.
    expect(screen.getByLabelText(active.label)).toBeSelected();
  });

  it('names the group so the radios are not announced loose', async () => {
    await renderPicker(choiceAt(0).key);

    expect(screen.getByLabelText('Reporting period')).toHaveProp('accessibilityRole', 'radiogroup');
  });
});

import { render, screen } from '@testing-library/react-native';

import { Chip } from '../Chip';
import { Text } from '../Text';

describe('Chip', () => {
  it('shows selection with a border as well as a fill', async () => {
    // Never the fill alone. Colour is not the state (spec §10) — the border
    // moves with it, and the caller carries the real answer in `aria-checked`.
    await render(
      <Chip selected accessibilityLabel="Groceries">
        <Text>Groceries</Text>
      </Chip>,
    );

    const className = screen.getByLabelText('Groceries').props.className;

    expect(className).toContain('bg-selected');
    expect(className).toContain('border-accent');
  });

  it('draws an unselected chip on the background colour', async () => {
    await render(
      <Chip accessibilityLabel="Groceries">
        <Text>Groceries</Text>
      </Chip>,
    );

    const className = screen.getByLabelText('Groceries').props.className;

    expect(className).toContain('bg-background');
    expect(className).toContain('border-border');
    expect(className).not.toContain('bg-selected');
  });

  it('tints the label with the selection', async () => {
    await render(
      <Chip selected accessibilityLabel="Groceries">
        <Text>Groceries</Text>
      </Chip>,
    );

    expect(screen.getByText('Groceries').props.className).toContain('text-accent');
  });

  // `it.each` rather than a loop with `unmount()`. Unmounting mid-test detaches
  // `screen`, and the *next* test in the file then fails to find anything —
  // which reads as a bug in that test rather than in this one. Each case gets
  // its own render and RNTL's own cleanup.
  it.each(['pill', 'block'] as const)('meets the touch-target floor at %s', async (shape) => {
    await render(
      <Chip shape={shape} accessibilityLabel={shape}>
        <Text>{shape}</Text>
      </Chip>,
    );

    expect(screen.getByLabelText(shape).props.className).toContain('min-h-touch');
  });

  it('sets no accessibility semantics of its own', async () => {
    /*
     * **A bare chip, because that is the only shape that catches a default.**
     *
     * The test below passes a role *in* and checks it comes back out, which
     * catches a prop written after `{...props}` and nothing else — a default
     * written *before* the spread is invisible to it, because the caller's own
     * value wins. Adding `accessibilityRole`, `accessibilityState` and
     * `aria-checked` defaults to `Chip` left all 42 suites and 424 tests green.
     *
     * The concrete harm is `SortControl`, which passes `accessibilityRole` and
     * `accessibilityState` and deliberately no `aria-checked`: under those
     * defaults its chip rendered `accessibilityState: { checked: true }` on a
     * `role="button"` — a sort button announcing as checked, with nothing red.
     *
     * The two tests are halves of one guarantee: this one says `Chip` adds
     * nothing, the next says `Chip` overrides nothing.
     */
    await render(
      <Chip testID="bare">
        <Text>Bare</Text>
      </Chip>,
    );

    const chip = screen.getByTestId('bare');

    expect(chip.props.accessibilityRole).toBeUndefined();
    expect(chip.props['aria-checked']).toBeUndefined();
    // `accessibilityState` is `{}` rather than absent — `Pressable` always
    // emits one, built from `disabled` and friends. So the guarantee is that it
    // carries no *selection* semantics, not that the object is missing.
    expect(chip.props.accessibilityState).toEqual({});
  });

  it('never overrides an accessibility role the caller set', async () => {
    // **The load-bearing property.** The four controls that use `Chip` are a
    // checkbox, two radios and a sort button, and their roles, states and
    // labels were arrived at by fixing #69 and #80. `Chip` takes the box and
    // leaves the semantics to the caller; anything it set here would either
    // override one of them or have to be overridden by all four.
    await render(
      <Chip accessibilityRole="radio" aria-checked={true} accessibilityLabel="Last 90 days">
        <Text>Last 90 days</Text>
      </Chip>,
    );

    const chip = screen.getByRole('radio', { name: 'Last 90 days' });

    expect(chip.props.accessibilityRole).toBe('radio');
    expect(chip).toBeChecked();
  });
});

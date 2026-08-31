import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { FormField } from '../FormField';

/**
 * `FormField` is one component behind every form in the app, and until #114
 * nothing tested it directly — the suites that exercised it went through
 * `sign-in` and the draft tests, which happen to use two of its seven props.
 *
 * So when its internals were replaced with `Input` / `Label` / `FormMessage`,
 * "every existing suite passes unmodified" was true and proved almost nothing.
 * These pin the props the issue calls load-bearing, each for the reason that
 * issue gives.
 */
const base = {
  label: 'Amount',
  value: '12.50',
  onChangeText: () => {},
};

describe('FormField', () => {
  it('gives the input the label as its accessible name', async () => {
    // The visible `Label` is a sibling, not a native `<label>`: `htmlFor` has
    // no equivalent here, `aria-labelledby` is unmapped on native and
    // `nativeID` does not reach the native tree. This prop is the only wiring
    // between the two, on both targets.
    await render(<FormField {...base} />);

    expect(screen.getByLabelText('Amount')).toBeOnTheScreen();
  });

  it('announces the error with the field, not just under it', async () => {
    // A screen reader user who has focused the field should hear why it was
    // rejected, rather than having to go looking for a red line below it.
    await render(<FormField {...base} error="Must be a number" />);

    expect(screen.getByLabelText('Amount').props.accessibilityHint).toBe('Must be a number');
  });

  it('falls back to the hint when there is no error', async () => {
    await render(<FormField {...base} hint="Negative for a refund." />);

    expect(screen.getByLabelText('Amount').props.accessibilityHint).toBe('Negative for a refund.');
  });

  it('shows the error and hides the hint when both are present', async () => {
    // Spec §8: the message sits against the field. Both at once would be two
    // lines saying different things under one input.
    await render(<FormField {...base} error="Must be a number" hint="Negative for a refund." />);

    expect(screen.getByText('Must be a number')).toBeOnTheScreen();
    expect(screen.queryByText('Negative for a refund.')).toBeNull();
  });

  it('marks the input invalid so the border turns negative', async () => {
    const { rerender } = await render(<FormField {...base} />);
    expect(screen.getByLabelText('Amount').props.className).toContain('border-border');

    await rerender(<FormField {...base} error="Must be a number" />);
    const input = screen.getByLabelText('Amount');

    expect(input.props.className).toContain('border-negative');
    expect(input.props.className).not.toContain('border-border');
  });

  it('renders a locked field muted on the surface colour', async () => {
    // `TextInput` has no `disabled` prop, so NativeWind's `disabled:` variant
    // never matches — the treatment is a conditional class, and getting that
    // wrong is silent because the classes simply never apply.
    await render(<FormField {...base} editable={false} />);

    const className = screen.getByLabelText('Amount').props.className;

    expect(className).toContain('bg-surface');
    expect(className).toContain('text-textMuted');
  });

  it('gives a multiline field two rows of height', async () => {
    await render(<FormField {...base} label="Reason" multiline />);

    expect(screen.getByLabelText('Reason').props.className).toContain('min-h-touch-2');
  });

  it('keeps a single-line field on the touch-target floor', async () => {
    await render(<FormField {...base} />);

    const className = screen.getByLabelText('Amount').props.className;

    expect(className).toContain('min-h-touch');
    expect(className).not.toContain('min-h-touch-2');
  });

  it('passes the keyboard and capitalisation props through', async () => {
    await render(
      <FormField {...base} keyboardType="numbers-and-punctuation" autoCapitalize="none" />,
    );

    const input = screen.getByLabelText('Amount');

    expect(input.props.keyboardType).toBe('numbers-and-punctuation');
    expect(input.props.autoCapitalize).toBe('none');
    // Never on: the amount field's keyboard has been known to "correct" a
    // decimal point.
    expect(input.props.autoCorrect).toBe(false);
  });

  it('masks the one field in the app that carries a credential', async () => {
    await render(<FormField {...base} label="Password" secureTextEntry />);

    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
  });

  it('renders the accessory beside the input', async () => {
    // The currency prefix. Shown, not chosen — v1 is PHP only.
    await render(<FormField {...base} accessory={<Text>PHP</Text>} />);

    expect(screen.getByText('PHP')).toBeOnTheScreen();
  });
});

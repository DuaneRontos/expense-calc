import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button, buttonVariants } from '../Button';
import { Text } from '../Text';

/**
 * `render` is awaited throughout: it returns a promise in
 * `@testing-library/react-native` 14, and `screen` is only bound once it
 * settles. Calling it without `await` fails with `render function has not been
 * called`, which points at the query rather than the missing await.
 */
describe('Button', () => {
  it('announces as a button and shows its label', async () => {
    await render(
      <Button>
        <Text>Save</Text>
      </Button>,
    );

    expect(screen.getByRole('button')).toBeOnTheScreen();
    expect(screen.getByText('Save')).toBeOnTheScreen();
  });

  it('calls onPress', async () => {
    const onPress = jest.fn();
    await render(
      <Button onPress={onPress}>
        <Text>Save</Text>
      </Button>,
    );

    fireEvent.press(screen.getByRole('button'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('announces disabled in both spellings, and does not fire', async () => {
    // Both, deliberately. `accessibilityState` never reaches the DOM under
    // react-native-web and `aria-disabled` is unmapped on native, so a button
    // carrying only one announces as enabled on the other platform while doing
    // nothing — which is what #69 was.
    const onPress = jest.fn();
    await render(
      <Button disabled onPress={onPress}>
        <Text>Save</Text>
      </Button>,
    );

    const button = screen.getByRole('button');

    // `toBeDisabled()` reads `aria-disabled ?? accessibilityState.disabled`.
    // Asserting the raw `aria-disabled` prop would fail even though the
    // component sets it: RN merges the flat prop into `accessibilityState`
    // before it reaches the host node, so a `Pressable` given `aria-disabled`
    // renders with `accessibilityState: { disabled: true }` and no
    // `aria-disabled` at all. Same finding as `expenses/__tests__/chipState`.
    expect(button).toBeDisabled();
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('styles its label without the caller restating the variant', async () => {
    // The reason `TextClassContext` exists: React Native does not inherit text
    // colour from a styled ancestor, so a plain `<Text>` inside a filled button
    // would render in the default colour against the accent background.
    await render(
      <Button variant="destructive">
        <Text>Delete</Text>
      </Button>,
    );

    expect(screen.getByText('Delete').props.className).toContain('text-background');
  });

  it('lets a caller override a variant class', async () => {
    // `cn` resolves the conflict in favour of the later class. Without
    // `twMerge` both survive and stylesheet order decides, which is the bug
    // this helper exists to prevent.
    await render(
      <Button variant="default" className="bg-negative">
        <Text>Danger</Text>
      </Button>,
    );

    const className = screen.getByRole('button').props.className;

    expect(className).toContain('bg-negative');
    expect(className).not.toContain('bg-accent');
  });
});

describe('every Button variant', () => {
  const variants = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;
  const sizes = ['default', 'sm', 'lg', 'icon'] as const;

  /**
   * The touch-target floor, asserted on the class string rather than a measured
   * height.
   *
   * Styles do not resolve under jest — `global.css` is stubbed — so the height
   * in pixels is not observable here. It does not need to be: that `min-h-touch`
   * *is* `MIN_TOUCH_TARGET` is pinned in `theme/__tests__/tokensMatchTailwind`,
   * so proving every variant carries the class proves the floor holds.
   *
   * This is the regression #108's review caught: `min-h-11` looked equivalent
   * and silently measured 38.5dp on device.
   */
  it.each(sizes)('keeps the touch-target floor at size %s', (size) => {
    for (const variant of variants) {
      expect(buttonVariants({ variant, size })).toContain('min-h-touch');
    }
  });

  it('constrains the square variant on both axes', () => {
    // `icon` removes the horizontal padding that gives the other sizes their
    // width, so height alone would leave a target 44 tall and a few points
    // wide. This assertion is here because the first version of `Button` used
    // `min-w-touch` before `tailwind.config.ts` defined it — an unknown class
    // compiles to nothing rather than failing, so the gap was invisible until
    // the class was grepped out of a native bundle.
    for (const variant of variants) {
      const classes = buttonVariants({ variant, size: 'icon' });

      expect(classes).toContain('min-h-touch');
      expect(classes).toContain('min-w-touch');
    }
  });

  it('never hard-codes a colour outside the token palette', () => {
    for (const variant of variants) {
      expect(buttonVariants({ variant })).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });
});

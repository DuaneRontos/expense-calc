import { buttonVariants } from '../Button';
import { cn } from '../cn';

/**
 * The text variants must not inherit the filled variants' horizontal padding.
 *
 * `size` is emitted after `variant` in `cva`'s output, so a `px-0` written as a
 * variant class loses to `px-4` and the label ends up inset by 16dp from
 * whatever it sits beside. Every text button in this app was written with
 * `minHeight` and no horizontal padding, so that inset would be a visual change
 * arriving inside a migration.
 */
describe('the text button variants', () => {
  it.each(['ghost', 'link'] as const)('carries no horizontal padding at %s', (variant) => {
    const classes = buttonVariants({ variant });

    // Emitted last, so it wins the merge in `cn`. Asserting on order rather
    // than presence, because both classes are in the string.
    expect(classes.lastIndexOf('px-0')).toBeGreaterThan(classes.lastIndexOf('px-4'));

    // **And on the string the component actually renders.** The order above
    // only decides the outcome *because* `cn` merges — if `cn` ever stopped
    // being `twMerge`, the assertion above would stay green while the padding
    // changed. This pins the thing that reaches the screen.
    expect(cn(classes)).not.toContain('px-4');
    expect(cn(classes)).toContain('px-0');
  });

  it.each(['default', 'destructive'] as const)('keeps it at %s', (variant) => {
    const classes = buttonVariants({ variant });

    expect(classes).toContain('px-4');
    expect(classes).not.toContain('px-0');
  });

  it('still meets the touch-target floor without it', () => {
    // The padding is what a filled button uses for width; a text button relies
    // on `min-h-touch` alone, so losing the padding must not lose the floor.
    expect(buttonVariants({ variant: 'link' })).toContain('min-h-touch');
  });
});

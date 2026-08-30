import { cn } from '../cn';

/**
 * `cn` promises the later class wins. That promise has to cover the class names
 * this project invented, not just the ones Tailwind ships.
 */
describe('cn', () => {
  it('collapses conflicting colours', () => {
    expect(cn('bg-accent', 'bg-negative')).toBe('bg-negative');
  });

  it('collapses the custom touch-target scale', () => {
    // **The reason `cn.ts` extends twMerge rather than using it plain.**
    // twMerge collapses a group only when it recognises the value, and `touch`
    // is not one its default `min-h` validators accept — so stock twMerge emits
    // both classes and lets stylesheet order decide. Colours escape this
    // because twMerge's colour groups accept an arbitrary name, which is why
    // the assertion above passes either way and this one does not.
    expect(cn('min-h-touch', 'min-h-0')).toBe('min-h-0');
    expect(cn('min-w-touch', 'min-w-0')).toBe('min-w-0');
  });

  it('lets the custom value win when it comes last', () => {
    // Both directions, because the failure was symmetric: a caller's
    // `min-h-[60px]` silently not applying is the same bug as a stray
    // `min-h-0` silently defeating the touch-target floor.
    expect(cn('min-h-0', 'min-h-touch')).toBe('min-h-touch');
    expect(cn('min-w-0', 'min-w-touch')).toBe('min-w-touch');
  });

  it('keeps classes that do not conflict', () => {
    expect(cn('min-h-touch', 'bg-accent')).toBe('min-h-touch bg-accent');
  });

  it('handles the conditional forms clsx exists for', () => {
    expect(cn('bg-accent', { 'bg-negative': true }, ['px-4'], null, undefined)).toBe(
      'bg-negative px-4',
    );
  });
});

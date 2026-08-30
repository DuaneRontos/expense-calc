import tailwindConfig from '../../../tailwind.config';
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

/**
 * Every custom theme value must be visible to `twMerge`.
 *
 * `min-h-touch` was invisible because the theme grew a value twMerge's
 * validators do not accept, and the symptom was silence: both classes emitted,
 * stylesheet order deciding. **The same is true of any future non-colour
 * `extend` key**, with an identical and equally quiet failure — so this walks
 * the theme rather than naming the two instances we already know about.
 *
 * Colours are exempt on purpose: twMerge's colour groups accept an arbitrary
 * name, so `bg-category-dining` collapses without being registered.
 */
describe('every custom theme value', () => {
  /** Theme key → the Tailwind class prefix that reads it. */
  const PREFIXES: Record<string, string> = {
    minHeight: 'min-h',
    minWidth: 'min-w',
  };

  /**
   * Read from the config's own `extend` block, not by diffing the resolved
   * theme against stock Tailwind.
   *
   * The diff approach looks more thorough and is much worse: extending
   * `colors` alone propagates into eighteen derived scales (`backgroundColor`,
   * `textColor`, `fill`, `stroke`, …), and NativeWind's preset contributes its
   * own (`trackColor`, `thumbColor`), so the walk returns ~180 entries that are
   * all colours or all someone else's. `extend` is exactly what this repo
   * added.
   */
  const extend = (tailwindConfig.theme?.extend ?? {}) as Record<string, Record<string, unknown>>;

  // Colours are exempt: twMerge's colour groups accept an arbitrary name, so
  // `bg-category-dining` collapses without being registered. Everything else
  // has to be taught.
  const custom = Object.entries(extend).flatMap(([key, values]) =>
    key === 'colors' || typeof values !== 'object' || values === null
      ? []
      : Object.keys(values).map((name) => ({ key, name })),
  );

  it('is covered by this test, so a new one cannot slip through unnoticed', () => {
    // Guards the guard twice: the walk must find what we know about, and a key
    // without a prefix mapping fails here rather than being skipped silently.
    expect(custom).toEqual(
      expect.arrayContaining([
        { key: 'minHeight', name: 'touch' },
        { key: 'minWidth', name: 'touch' },
      ]),
    );

    for (const { key } of custom) {
      expect(PREFIXES[key]).toBeDefined();
    }
  });

  it('collapses against a stock class in its own group', () => {
    for (const { key, name } of custom) {
      const prefix = PREFIXES[key]!;

      expect(cn(`${prefix}-${name}`, `${prefix}-0`)).toBe(`${prefix}-0`);
      expect(cn(`${prefix}-0`, `${prefix}-${name}`)).toBe(`${prefix}-${name}`);
    }
  });
});

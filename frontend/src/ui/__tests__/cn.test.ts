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
  /**
   * Theme key → **every** Tailwind class prefix that reads it.
   *
   * A list, not a string: one theme key can back several twMerge groups.
   * `spacing` alone backs `p-`, `px-`, `m-`, `gap-`, `w-`, `h-`, `inset-` and
   * more, each collapsed independently — so registering one prefix and
   * declaring victory leaves the rest silently broken with this test green.
   * Demonstrated: with only `p` registered, `p-gutter` collapsed while
   * `gap-gutter` and `m-gutter` both survived alongside their stock
   * counterparts.
   */
  const PREFIXES: Record<string, string[]> = {
    minHeight: ['min-h'],
    minWidth: ['min-w'],
  };

  /**
   * Read from the config's own `extend` block, not by diffing the resolved
   * theme against stock Tailwind.
   *
   * The diff approach looks more thorough and is much worse: extending
   * `colors` alone propagates into eighteen derived scales (`backgroundColor`,
   * `textColor`, `fill`, `stroke`, …), and NativeWind's preset contributes its
   * own (`trackColor`, `thumbColor`), so the walk returns ~180 entries that are
   * all colours or all someone else's.
   *
   * **The trade is that this covers `theme.extend` only.** `screens` is set at
   * the top level of `theme` — it replaces Tailwind's rather than extending
   * them — and is therefore invisible here. Harmless for `screens` in
   * particular, since twMerge compares modifier sets structurally and needs no
   * knowledge of the names; but a future top-level override would get no
   * coverage, so add it by hand if one appears.
   */
  const extend = (tailwindConfig.theme?.extend ?? {}) as Record<string, unknown>;

  // Colours are exempt: twMerge's colour groups accept an arbitrary name, so
  // `bg-category-dining` collapses without being registered. Everything else
  // has to be taught.
  const walkable = Object.entries(extend).filter(([key]) => key !== 'colors');

  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null;

  /**
   * Keys this test cannot inspect.
   *
   * Tailwind allows any `extend` value to be a function of `({ theme })`, and a
   * `typeof values !== 'object'` guard skips those **silently** — which
   * defeated the point: `spacing: () => ({ gutter: '18px' })` left every
   * assertion here green while `cn('p-gutter', 'p-0')` returned both classes.
   * Collected and failed rather than skipped.
   */
  const unwalkable = walkable.filter(([, values]) => !isPlainObject(values)).map(([key]) => key);

  const custom = walkable.flatMap(([key, values]) =>
    isPlainObject(values) ? Object.keys(values).map((name) => ({ key, name })) : [],
  );

  it('is inspectable, so nothing is skipped without saying so', () => {
    expect(unwalkable).toEqual([]);
  });

  it('is covered by this test, so a new one cannot slip through unnoticed', () => {
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

  it('collapses against a stock class in every group its key backs', () => {
    for (const { key, name } of custom) {
      for (const prefix of PREFIXES[key]!) {
        expect(cn(`${prefix}-${name}`, `${prefix}-0`)).toBe(`${prefix}-0`);
        expect(cn(`${prefix}-0`, `${prefix}-${name}`)).toBe(`${prefix}-${name}`);
      }
    }
  });
});

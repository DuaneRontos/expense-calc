import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `twMerge`, taught about the class names this project added.
 *
 * **The stock merge silently does not apply to `min-h-touch` / `min-w-touch`.**
 * It collapses a class group only when it recognises the *value*, and `touch`
 * is not one its default `min-h` validators accept — so `cn('min-h-touch',
 * 'min-h-0')` emits both, and which one wins is decided by the order of two
 * rules in the generated stylesheet rather than by the caller. Colours escape
 * this because twMerge's colour groups accept an arbitrary name, which is why
 * `bg-negative` really does drop `bg-accent`.
 *
 * That cuts both ways and neither is acceptable: a caller's deliberate
 * `min-h-[60px]` might not take, and a stray `min-h-0` might silently defeat
 * the touch-target floor the rest of this codebase spends several doc blocks
 * defending.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'min-h': ['min-h-touch'],
      'min-w': ['min-w-touch'],
    },
  },
});

/**
 * Joins class strings and lets the later one win.
 *
 * The shadcn helper, because the problem it solves is the same here: a
 * component declares base classes, a variant adds more, and a caller passes
 * `className` expecting theirs to take effect. Plain concatenation does not do
 * that — both survive and stylesheet order decides.
 *
 * `clsx` handles the conditional forms (`{ 'x': cond }`, arrays, nullish)
 * before the merge sees them.
 *
 * **This does not reach `asChild`.** `@rn-primitives/slot` joins `className`
 * strings rather than merging them, so a slotted child's classes and the
 * parent's both survive. See `Button`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

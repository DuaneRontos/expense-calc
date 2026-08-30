import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class strings and lets the later one win.
 *
 * The shadcn helper, unchanged, because the problem it solves is the same
 * here: a component declares base classes, a variant adds more, and a caller
 * passes `className` expecting theirs to take effect. Plain concatenation does
 * not do that — `"bg-accent"` and `"bg-negative"` would both be emitted and the
 * winner decided by stylesheet order rather than by the caller.
 *
 * `twMerge` understands that those two occupy the same property and drops the
 * earlier. `clsx` handles the conditional forms (`{ 'x': cond }`, arrays,
 * nullish) before it.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

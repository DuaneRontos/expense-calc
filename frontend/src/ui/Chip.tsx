import { cva, type VariantProps } from 'class-variance-authority';
import { Pressable, type PressableProps } from 'react-native';

import { TextClassContext } from './Text';
import { cn } from './cn';

/**
 * The shared look of a selection chip. **Styling only, deliberately.**
 *
 * This does not use `@rn-primitives/radio-group`, `checkbox` or `toggle-group`,
 * and that is the decision rather than an omission. All three depend on
 * `@radix-ui/*` and delegate to it on web — `radio-group.web.js` renders
 * `<RadioGroup.Root>` from `@radix-ui/react-radio-group`. Adopting them adds
 * Radix to a codebase whose spec §9.7 records that Radix is the reason
 * shadcn/ui itself cannot be used here.
 *
 * Their native path is also not a drop-in for what these controls already do:
 * it sets `role`, where this repo's chips deliberately set `accessibilityRole`
 * on the *items* and `role` only on the group, because the two reach opposite
 * platforms. That distinction was arrived at by fixing #69 and #80 and is
 * written up in `ExpenseFilters`.
 *
 * So `Chip` takes the box and leaves the semantics to the caller: every
 * accessibility prop passes straight through untouched, which is what lets the
 * chip suites keep passing unmodified. **Do not add `accessibilityRole`,
 * `aria-checked` or `accessibilityState` here** — they differ per control
 * (checkbox vs radio vs a sort button that reverses), and centralising them
 * would flatten distinctions three sets of comments exist to preserve.
 */
const chipVariants = cva('flex-row items-center border min-h-touch', {
  variants: {
    shape: {
      /** Category chips: a dot, a label, and a pill around them. */
      pill: 'gap-1 rounded-full px-2',
      /** Period and sort chips: a centred label in a rounded box. */
      block: 'justify-center rounded-md px-2',
    },
    selected: {
      // Never the fill alone: the border moves with it, and the caller says so
      // in `aria-checked`. Colour is not the state (spec §10).
      true: 'border-accent bg-selected',
      false: 'border-border bg-background',
    },
  },
  defaultVariants: { shape: 'block', selected: false },
});

const chipTextVariants = cva('text-[13px]', {
  variants: { selected: { true: 'text-accent', false: 'text-text' } },
  defaultVariants: { selected: false },
});

export type ChipProps = PressableProps &
  VariantProps<typeof chipVariants> & { className?: string };

export function Chip({ className, shape, selected, ...props }: ChipProps) {
  return (
    <TextClassContext.Provider value={chipTextVariants({ selected })}>
      <Pressable className={cn(chipVariants({ shape, selected }), className)} {...props} />
    </TextClassContext.Provider>
  );
}

export { chipTextVariants, chipVariants };

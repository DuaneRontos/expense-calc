import { Slot } from '@rn-primitives/slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Pressable, type PressableProps } from 'react-native';

import { cn } from './cn';
import { TextClassContext } from './Text';

/**
 * shadcn's Button, on React Native primitives.
 *
 * Variant names and the `cva` structure follow shadcn so the vocabulary
 * transfers, but the colours are this app's — `accent`, `negative`, `surface`,
 * `border` come from `theme/tokens.ts` through `tailwind.config.ts`, so a
 * button and a chart legend cannot disagree about what "negative" means.
 *
 * **Every variant is at least `min-h-touch` tall.** That is `MIN_TOUCH_TARGET`,
 * not the visually similar `min-h-11`, which is only 44 while `inlineRem` is
 * 16 — see `metro.config.js`. Size variants may grow it and must never shrink
 * it below that floor, including `icon`.
 *
 * **A caller's `className` can override it, and that is deliberate.** Since
 * `cn` learned this scale, `<Button className="min-h-0">` really does drop the
 * floor — where before it survived by accident, because `twMerge` could not see
 * the class. The accident was not worth keeping: the same blindness meant a
 * legitimate `min-h-[60px]` did not reliably apply either, and a floor that
 * cannot be raised is as wrong as one that cannot be trusted.
 *
 * So the floor is the default, not a lock. `button.test.tsx` asserts it on the
 * *composed* `className`, so the default composition is pinned; a call site
 * that shrinks it is opting out in writing, and spec §2 makes that a review
 * question for whoever writes it.
 */
const buttonVariants = cva(
  'flex-row items-center justify-center rounded-md min-h-touch active:opacity-80',
  {
    variants: {
      /**
       * **Disabled is per-variant, not a blanket `disabled:opacity-50`.**
       *
       * A filled button goes solid grey when it cannot be pressed — that is
       * what every screen in this app already did with
       * `backgroundColor: submitting ? palette.border : palette.accent`, and a
       * half-transparent accent reads as a rendering glitch rather than a
       * state. The text variants have no fill to swap, so they dim instead.
       */
      variant: {
        default: 'bg-accent disabled:bg-border',
        /**
         * Dimmed, not greyed — unlike `default`.
         *
         * Every filled button in this app went solid `border` when it could not
         * be pressed, and for the primary action that reads correctly. It does
         * not here: the only `destructive` button in the app is disabled
         * *because the delete is in flight*, and the old code pinned
         * `backgroundColor: palette.negative` unconditionally so it stayed red
         * throughout. A button that turns grey at the moment it commits an
         * irreversible action looks like a different button.
         */
        destructive: 'bg-negative disabled:opacity-50',
        outline: 'border border-border bg-background disabled:opacity-50',
        secondary: 'bg-surface disabled:opacity-50',
        /** The quiet action beside a primary one — "Cancel", "Keep it". */
        ghost: 'bg-transparent disabled:opacity-50',
        /** A text action that still asks to be pressed — "Sign out", "Try again". */
        link: 'bg-transparent disabled:opacity-50',
      },
      size: {
        default: 'px-4 py-2',
        sm: 'px-3 py-1',
        lg: 'px-6 py-3',
        // Square, and still a legal target: the floor is a minimum on both axes
        // here, not a height with a narrow hit area beside it.
        icon: 'min-w-touch px-0 py-0',
      },
    },
    /**
     * The text variants carry no horizontal padding.
     *
     * A filled button needs padding to give its background shape; a text
     * button's "edge" is the glyphs, so `px-4` just pushes the label away from
     * whatever it sits beside — and every text button in this app was written
     * with `minHeight` and nothing else. `min-h-touch` still gives it a full
     * 44dp target vertically, which is where the pressable area actually
     * matters for a row of text.
     *
     * `justify-start` for the same reason the padding goes: a text button in a
     * column stretches to full width, and `justify-center` then floats its
     * label in the middle of the screen where it used to sit at the left
     * margin with the content around it. In a row it shrinks to fit and the
     * justification is moot, which is why only the column-context buttons
     * ("Back to the list", "Try again") looked wrong.
     *
     * A compound variant rather than a variant class, because `size` is emitted
     * after `variant` and its `px-4` would otherwise win.
     */
    compoundVariants: [{ variant: ['ghost', 'link'], class: 'px-0 justify-start' }],
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

/**
 * The label styling each variant publishes to its `Text` children.
 *
 * Kept as a parallel `cva` rather than folded into `buttonVariants`, because
 * these classes are applied to a different element — the container cannot carry
 * `text-*` on behalf of its children on this platform. See `TextClassContext`.
 */
const buttonTextVariants = cva('font-semibold', {
  variants: {
    /**
     * `ghost` is muted and `link` is not underlined — both deviate from
     * upstream shadcn, and both follow what this app already did.
     *
     * A ghost button here is always the de-emphasised half of a pair
     * ("Cancel" beside "Save"), which `text-textMuted` says and `text-text`
     * does not. Underlining a link is a web convention that no button in this
     * app has ever had, and it would arrive as a visual change dressed up as a
     * migration.
     */
    variant: {
      default: 'text-background',
      destructive: 'text-background',
      outline: 'text-text',
      secondary: 'text-text',
      ghost: 'text-textMuted',
      link: 'text-accent',
    },
    /**
     * `text-sm` by default, which is both shadcn's own default and what this
     * app already had.
     *
     * React Native's `Text` has no intrinsic size and react-native-web's base
     * is 14; every migrated label was 14 before this. `text-base` would make
     * button labels a step larger than the body text beside them on all three
     * targets — a change nobody asked for, arriving through the primitive
     * rather than through a decision.
     */
    size: {
      default: 'text-sm',
      sm: 'text-sm',
      lg: 'text-base',
      icon: 'text-sm',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export type ButtonProps = PressableProps &
  VariantProps<typeof buttonVariants> & {
    className?: string;
    /**
     * Announces work in flight, separately from `disabled`.
     *
     * Both are needed and they are not the same claim: `disabled` says a press
     * will do nothing, `busy` says one already did and has not finished. Half
     * the buttons in this app set both while submitting, and a screen reader
     * that hears only "dimmed" cannot tell a pressed button from a blocked one.
     */
    busy?: boolean;
    /**
     * Renders the child element instead of a `Pressable`, handing it these
     * props.
     *
     * **Two behaviours of `@rn-primitives/slot` that this does not paper
     * over**, because both are worth knowing before reaching for it:
     *
     * `className` is **joined, not merged**. The slot concatenates the two
     * strings, so `cn`'s "later one wins" does not apply — a child's
     * `bg-surface` and this button's `bg-accent` are both emitted and
     * stylesheet order decides. Pass one or the other, never competing values
     * for the same property.
     *
     * A plain-string child renders **nothing**: `Slot` returns `null` for text
     * children after a bare `console.log`. `<Button asChild>Save</Button>`
     * typechecks — `PressableProps['children']` is `ReactNode` — and
     * disappears. Wrap it in an element.
     */
    asChild?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  disabled,
  busy = false,
  accessibilityState,
  ...props
}: ButtonProps) {
  // Generic `Slot`, not the deprecated per-element `Slot.Pressable` — the
  // per-element exports went away in @rn-primitives/slot 1.5 and older
  // react-native-reusables snippets still show them.
  const Component = asChild ? Slot<typeof Pressable> : Pressable;

  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Component
        // `accessibilityRole` rather than `role`: `button` maps on web, iOS and
        // Android alike, while the two props reach opposite platforms for other
        // values. See the note in `expenses/ExpenseFilters.tsx`.
        accessibilityRole="button"
        // Both spellings, deliberately. `accessibilityState` never reaches the
        // DOM under react-native-web, and `aria-disabled` is unmapped on
        // native — a button that announces as enabled while doing nothing is
        // the failure #69 was.
        // **Merged, not overwritten.** `accessibilityState` is destructured out
        // of `...props` so a caller passing their own — `{ selected: true }` on
        // a toggle, say — extends this button's state instead of silently
        // replacing `disabled` *and* `busy` with undefined. The caller's keys
        // win where they overlap, which is what a prop should do; the ones they
        // did not mention survive, which spreading alone did not give.
        accessibilityState={{ disabled: !!disabled, busy, ...accessibilityState }}
        aria-disabled={!!disabled}
        aria-busy={busy}
        disabled={disabled}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { buttonTextVariants, buttonVariants };

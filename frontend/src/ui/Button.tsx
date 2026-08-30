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
 */
const buttonVariants = cva(
  'flex-row items-center justify-center rounded-md min-h-touch active:opacity-80 disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-accent',
        destructive: 'bg-negative',
        outline: 'border border-border bg-background',
        secondary: 'bg-surface',
        ghost: 'bg-transparent',
        link: 'bg-transparent',
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
    variant: {
      default: 'text-background',
      destructive: 'text-background',
      outline: 'text-text',
      secondary: 'text-text',
      ghost: 'text-text',
      link: 'text-accent underline',
    },
    size: {
      default: 'text-base',
      sm: 'text-sm',
      lg: 'text-base',
      icon: 'text-base',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export type ButtonProps = PressableProps &
  VariantProps<typeof buttonVariants> & {
    className?: string;
    /** Renders the child element instead of a `Pressable`, handing it these props. */
    asChild?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  disabled,
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
        accessibilityState={{ disabled: !!disabled }}
        aria-disabled={!!disabled}
        disabled={disabled}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { buttonTextVariants, buttonVariants };

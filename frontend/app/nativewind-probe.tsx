/**
 * THROWAWAY. Spike #108 only — delete this file when the spike closes.
 *
 * Exists to answer one question on three targets: does a component styled
 * *only* with `className` render correctly on web, iOS and Android? Everything
 * it needs is inlined rather than imported, so removing it removes the whole
 * experiment.
 *
 * It exercises the three layers the migration series depends on:
 *
 *   1. NativeWind's interop — `className` on a bare React Native component
 *   2. The shadcn variant pattern — `cva` variants merged through `cn()`
 *   3. `@rn-primitives/slot` — Radix's `asChild` model, which is how the RN
 *      primitives compose
 *
 * A layer that does not work here does not work in `Button` either.
 */
import { Slot } from '@rn-primitives/slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { Pressable, Text, View } from 'react-native';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const probeVariants = cva('items-center justify-center rounded-md px-4 min-h-11', {
  variants: {
    variant: {
      default: 'bg-blue-600',
      destructive: 'bg-red-700',
      outline: 'border border-neutral-300 bg-transparent',
    },
  },
  defaultVariants: { variant: 'default' },
});

function ProbeButton({
  label,
  variant,
  className,
  asChild,
}: VariantProps<typeof probeVariants> & {
  label: string;
  className?: string;
  asChild?: boolean;
}) {
  // Generic `Slot`, not `Slot.Pressable`. The per-element exports
  // (`Slot.Pressable`, `Slot.View`, `Slot.Text`) are **deprecated** in
  // @rn-primitives/slot 1.5 in favour of one generic component — older RNR
  // snippets still show the old form. Noted for #112.
  const Component = asChild ? Slot<typeof Pressable> : Pressable;
  return (
    <Component className={cn(probeVariants({ variant }), className)}>
      <Text className={cn('text-base font-semibold', variant === 'outline' ? 'text-neutral-900' : 'text-white')}>
        {label}
      </Text>
    </Component>
  );
}

export default function NativeWindProbe() {
  return (
    <View className="flex-1 gap-4 bg-white p-6">
      <Text className="text-2xl font-bold text-neutral-900">NativeWind probe</Text>

      {/* Layer 1: plain interop. If this box is not grey, nothing else matters. */}
      <View className="rounded-lg bg-neutral-100 p-4">
        <Text className="text-sm text-neutral-600">
          Layer 1 — className on View and Text
        </Text>
      </View>

      {/* Layer 2: cva variants through cn(). */}
      <ProbeButton label="Default" variant="default" />
      <ProbeButton label="Destructive" variant="destructive" />
      <ProbeButton label="Outline" variant="outline" />

      {/*
        `cn()` must win here: `bg-green-700` arrives after the variant's
        `bg-blue-600`, and tailwind-merge is what makes the later one survive.
        A green button proves the merge; a blue one proves it silently failed.
      */}
      <ProbeButton label="Merged override (must be green)" className="bg-green-700" />

      {/* Layer 3: Slot / asChild. */}
      <ProbeButton label="asChild via Slot" asChild />

      {/*
        Layer 4 — responsive, on this app's own bands.

        `medium` and `expanded` are the screens defined in `tailwind.config.js`
        from `BREAKPOINTS`; Tailwind's stock `sm:`/`lg:` are deliberately gone,
        so they would fail rather than silently resolve to 640/1024. Checking
        this against `useLayout()` is the point: if the two ever disagree, the
        chrome and the content inside it disagree about which band they are in.
      */}
      <View className="rounded-lg bg-purple-200 p-4 medium:bg-amber-200 expanded:bg-teal-200">
        <Text className="text-sm text-neutral-900">
          Layer 4 — responsive: purple &lt; 600 (compact), amber 600–1024
          (medium), teal &gt; 1024 (expanded)
        </Text>
      </View>

      {/*
        Layer 5 — the touch-target floor, which is the one dimension `inlineRem`
        can silently break. `min-h-11` is 2.75rem: 44dp with `inlineRem: 16`
        set in `metro.config.js`, and 38.5dp at NativeWind's default of 14.
        Every button above carries the same class.
      */}
      <View className="min-h-11 justify-center rounded-lg bg-neutral-200 px-4">
        <Text className="text-sm text-neutral-900">
          Layer 5 — min-h-11 must measure 44dp on device, not 38.5
        </Text>
      </View>
    </View>
  );
}

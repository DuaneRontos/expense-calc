import { View, type ViewProps } from 'react-native';

import { cn } from './cn';

/**
 * A placeholder shaped like the thing that has not arrived yet.
 *
 * **Only worth using where the layout is known ahead of the data.** A skeleton
 * of the wrong shape is a worse loading state than a spinner: it promises a
 * structure and then reflows into a different one, which reads as a bug rather
 * than as loading. A spinner promises nothing and is the honest choice when the
 * shape is genuinely unknown.
 *
 * **Not animated.** shadcn's version pulses via a CSS keyframe, which has no
 * cross-platform equivalent here — the animation would need `reanimated`, and
 * an element that pulses on web and sits still on device is a worse
 * inconsistency than one that sits still everywhere. The surface colour reads
 * as "not content" on its own.
 *
 * `aria-hidden` because it carries no information: the screen announces its own
 * loading state in words, and a screen reader stopping on six grey rectangles
 * learns nothing from them.
 *
 * **`bg-border`, not `bg-surface`.** The first version used `surface`
 * (`#F6F7F9`), which is 1.07:1 against the content background — with no
 * animation to catch the eye and the old `ActivityIndicator` removed, the first
 * load became six near-invisible rectangles and a line of 12px muted text.
 * `surface` is also the wrong *role* in this palette: it fills a disabled input
 * and a secondary button, i.e. "a control, subdued".
 *
 * `border` (`#DFE3E8`) is about four times the luminance delta and is the
 * neutral-edge role, which is nearer. It is still only ~1.3:1 — the honest
 * reading is that this palette has no placeholder token at all, which is #135's
 * territory rather than something to invent here.
 */
export function Skeleton({ className, ...props }: ViewProps & { className?: string }) {
  return <View aria-hidden className={cn('rounded-md bg-border', className)} {...props} />;
}

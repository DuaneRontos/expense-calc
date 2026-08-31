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
 */
export function Skeleton({ className, ...props }: ViewProps & { className?: string }) {
  return <View aria-hidden className={cn('rounded-md bg-surface', className)} {...props} />;
}

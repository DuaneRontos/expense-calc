import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/**
 * The measured width of a container, for charts that size themselves.
 *
 * An SVG needs pixel dimensions, but the width available to it depends on the
 * breakpoint, the sidebar, and on web the window — none of which a caller
 * should have to compute and pass down. Measuring is the only approach that is
 * right on all three targets.
 *
 * The setter compares before storing. `onLayout` fires on every layout pass,
 * and an unconditional `setState` there re-renders, which lays out, which fires
 * `onLayout` — a loop that presents as the chart flickering forever.
 */
export function useMeasuredWidth(): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = Math.round(event.nativeEvent.layout.width);
    setWidth((current) => (current === measured ? current : measured));
  }, []);

  return [width, onLayout];
}

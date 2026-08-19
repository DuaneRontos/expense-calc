import { useEffect, useState } from 'react';

/**
 * A text field that filters as you type, without a request per keystroke.
 *
 * The list's own generation guard already makes an overtaken response harmless,
 * so this is about load rather than correctness — "SM Supermarket" is fourteen
 * requests for one intent.
 */
export function useDebounced<T>(value: T, delayMs = 350): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

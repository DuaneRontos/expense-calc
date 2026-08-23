import { useEffect, useState } from 'react';

/**
 * True only once `value` has stayed true for `delayMs` (issue #16).
 *
 * **A spinner that appears and vanishes inside 80ms is worse than none.** It
 * reads as a glitch rather than as progress, and against a local API most
 * report requests return faster than a person can perceive. Holding the
 * indicator back until the wait is real means a fast response simply appears.
 *
 * The flag drops immediately when `value` does, so nothing lingers after the
 * data has arrived.
 */
export function useDelayedFlag(value: boolean, delayMs = 250): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!value) {
      return;
    }
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [value, delayMs]);

  // Derived, so nothing has to write `false` back when the wait ends: the flag
  // is "still waiting *and* the wait got long enough to be worth mentioning".
  return value && elapsed;
}

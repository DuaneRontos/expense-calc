import { useEffect, useState } from 'react';

import { todayInManila } from './periods';

const DAY_MS = 86_400_000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Today in Manila, re-read when Manila crosses midnight.
 *
 * **Reading it once per render is not enough**, because nothing schedules a
 * render at the boundary. A web tab left open overnight keeps asking for
 * yesterday's window until some unrelated render happens to move it — and on
 * the 31st that means "This month" is still reporting last month, which is
 * wrong rather than merely stale.
 */
export function useManilaToday(): string {
  const [today, setToday] = useState(todayInManila);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const armForNextMidnight = () => {
      // Manila is a constant +08:00 — no DST since 1978 — so shifting the clock
      // by the offset makes midnight *there* an exact multiple of a day *here*,
      // with no calendar arithmetic and no host zone involved.
      const sinceMidnight = (Date.now() + MANILA_OFFSET_MS) % DAY_MS;

      // Re-armed from a fresh `Date.now()` rather than run on a 24-hour
      // interval: a timer that fires late — a backgrounded tab, a sleeping
      // phone — would otherwise carry its lateness into every day after it.
      timer = setTimeout(() => {
        setToday(todayInManila());
        armForNextMidnight();
      }, DAY_MS - sinceMidnight + 1_000);
    };

    armForNextMidnight();
    return () => clearTimeout(timer);
  }, []);

  return today;
}

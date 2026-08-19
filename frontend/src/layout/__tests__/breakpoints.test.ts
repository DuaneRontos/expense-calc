import { BREAKPOINTS, layoutSizeFor, MIN_TOUCH_TARGET } from '../breakpoints';

describe('layoutSizeFor', () => {
  it('matches the three bands of spec §2', () => {
    expect(layoutSizeFor(375)).toBe('compact');
    expect(layoutSizeFor(599)).toBe('compact');
    expect(layoutSizeFor(600)).toBe('medium');
    expect(layoutSizeFor(900)).toBe('medium');
    expect(layoutSizeFor(1025)).toBe('expanded');
    expect(layoutSizeFor(1440)).toBe('expanded');
  });

  it('gives 1024 to medium, which is an iPad in landscape', () => {
    // The spec writes the bands as `< 600`, `600–1024`, `> 1024`, naming 1024
    // twice. Pinned here so the resolution is a decision rather than a detail
    // of whichever comparison was written first.
    expect(layoutSizeFor(BREAKPOINTS.expanded)).toBe('medium');
  });

  it('keeps touch targets at the mobile floor', () => {
    expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  });
});

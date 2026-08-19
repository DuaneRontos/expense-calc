import { sampleBreakdown, sampleOverTime } from '../fixtures';
import { splitAmount } from '../../money/format';
import type { ReportBucket } from '../../api/types';

/**
 * Sums decimal strings exactly, in centavos.
 *
 * Deliberately not `reduce((sum, b) => sum + Number(b.total), 0)`. That is the
 * float summation this whole codebase exists to avoid, and a test that used it
 * could pass while the values it checked were wrong in the last centavo.
 */
function netMinor(buckets: ReportBucket[]): bigint {
  return buckets.reduce((sum, bucket) => {
    const { negative, integer, fraction } = splitAmount(bucket.total);
    const magnitude = BigInt(integer + fraction);
    return sum + (negative ? -magnitude : magnitude);
  }, 0n);
}

function toMinor(amount: string): bigint {
  const { negative, integer, fraction } = splitAmount(amount);
  const magnitude = BigInt(integer + fraction);
  return negative ? -magnitude : magnitude;
}

describe('report fixtures', () => {
  // The fixtures stand in for real responses until #13. A total that does not
  // reconcile with its own buckets would be teaching the wrong thing about the
  // API being imitated — and reconciling a report total against the sum of its
  // parts is the check spec §11 gates the reporting phase on.
  it('breakdown total is the net of its buckets', () => {
    expect(netMinor(sampleBreakdown.buckets)).toBe(toMinor(sampleBreakdown.total));
  });

  it('over-time total is the net of its buckets', () => {
    expect(netMinor(sampleOverTime.buckets)).toBe(toMinor(sampleOverTime.total));
  });

  it('keeps a negative bucket in each fixture, so the rules stay exercised', () => {
    // Spec §7's negative-bucket handling is the easiest rule here to regress.
    // A fixture set with no negatives lets that regression through unseen.
    expect(sampleBreakdown.buckets.some((b) => b.total.startsWith('-'))).toBe(true);
    expect(sampleOverTime.buckets.some((b) => b.total.startsWith('-'))).toBe(true);
  });

  it('keeps a contiguous zero bucket, which the time axis must not omit', () => {
    expect(sampleOverTime.buckets.some((b) => b.total === '0.00')).toBe(true);
  });
});

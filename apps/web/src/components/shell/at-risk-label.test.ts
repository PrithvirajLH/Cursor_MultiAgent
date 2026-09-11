import { describe, expect, it } from 'vitest';
import { formatAtRiskThreshold } from './at-risk-label';

/**
 * Card 1.70 ② — the badge said `Breach risk · 1h` while the list used four
 * hours and the count used `SLA_AT_RISK_THRESHOLD_MINUTES` (default 120).
 *
 * ⚠️ THIS FILE IS THE PART THE CARD SAYS WILL ROT FIRST. Fixing the two numbers
 * and leaving the words hard-coded only resets the clock — it had already
 * drifted twice, which is how one idea ended up with three values. So the
 * assertions below are about the label FOLLOWING the setting, not about any
 * particular number.
 */
describe('formatAtRiskThreshold (card 1.70 ②)', () => {
  it('⚠️ follows an unusual threshold instead of a familiar-looking one', () => {
    // THE REGRESSION ASSERTION. 90 is deliberately not a whole number of hours
    // and not the default: a label that rounded it to "1h" or "2h", or that
    // quietly printed a constant, fails here. Anything hard-coded cannot pass
    // this line.
    expect(formatAtRiskThreshold(90)).toBe('90m');
    expect(formatAtRiskThreshold(37)).toBe('37m');
    expect(formatAtRiskThreshold(455)).toBe('455m');
  });

  it('reads whole hours as hours, which is how the desk talks about SLAs', () => {
    expect(formatAtRiskThreshold(60)).toBe('1h');
    expect(formatAtRiskThreshold(120)).toBe('2h');
    expect(formatAtRiskThreshold(240)).toBe('4h');
  });

  it('⚠️ never renders the old hard-coded "1h" for the default setting', () => {
    // The specific wrong label this card removes: the default is 120 minutes,
    // and the badge claimed one hour. If this ever reads "1h" again the bug is
    // back.
    expect(formatAtRiskThreshold(120)).not.toBe('1h');
    expect(formatAtRiskThreshold(120)).toBe('2h');
  });

  it('returns null rather than inventing a number', () => {
    // The caller renders the bare "Breach risk" when this is null. A missing
    // value must not become a confident wrong one - that is the whole failure
    // mode of the label this replaces.
    expect(formatAtRiskThreshold(undefined)).toBeNull();
    expect(formatAtRiskThreshold(0)).toBeNull();
    expect(formatAtRiskThreshold(-30)).toBeNull();
    expect(formatAtRiskThreshold(Number.NaN)).toBeNull();
    expect(formatAtRiskThreshold(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('rounds a fractional setting rather than printing a decimal', () => {
    // parsePositiveInt on the server makes this unlikely, but a label reading
    // "90.5m" would look broken to a reader for no useful gain.
    expect(formatAtRiskThreshold(90.4)).toBe('90m');
    expect(formatAtRiskThreshold(119.6)).toBe('2h');
  });
});

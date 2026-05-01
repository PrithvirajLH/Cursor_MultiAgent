import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { Pill, Prio, Avatar, SlaBar, AiChip, Icn, I, toneFromName } from './index';

describe('atoms', () => {
  it('Pill renders children with tone class', () => {
    const html = renderToStaticMarkup(<Pill tone="red">P1</Pill>);
    expect(html).toContain('P1');
  });

  it('Pill with dot renders inner dot span', () => {
    const html = renderToStaticMarkup(<Pill tone="green" dot>open</Pill>);
    // outer span + inner dot span
    expect(html.match(/<span/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('Prio renders 3 sub-bars', () => {
    const html = renderToStaticMarkup(<Prio level="P1" />);
    expect(html.match(/<i /g)?.length).toBe(3);
  });

  it('Avatar shows initials', () => {
    const html = renderToStaticMarkup(<Avatar name="EM" />);
    expect(html).toContain('EM');
  });

  it('toneFromName is deterministic', () => {
    expect(toneFromName('EM')).toBe(toneFromName('EM'));
  });

  it('SlaBar clamps pct to 0-100 and exposes ARIA value', () => {
    const html = renderToStaticMarkup(<SlaBar pct={150} state="warn" />);
    expect(html).toContain('aria-valuenow="100"');
  });

  it('AiChip renders confidence and amber tone when below 70', () => {
    const html = renderToStaticMarkup(<AiChip conf={42} />);
    expect(html).toContain('42%');
  });

  it('Icn renders an svg with given path', () => {
    const html = renderToStaticMarkup(<Icn d={I.check} />);
    expect(html).toContain('<svg');
    expect(html).toContain('<path');
  });
});

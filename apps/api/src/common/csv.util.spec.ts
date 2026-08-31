import { toCsvRow } from './csv.util';

describe('toCsvRow', () => {
  it('joins plain values and ends the record with a newline', () => {
    expect(toCsvRow(['IS_20260830_001', 'Printer offline', 42])).toBe(
      'IS_20260830_001,Printer offline,42\n',
    );
  });

  it('quotes a value containing a comma', () => {
    expect(toCsvRow(['Broken, urgent'])).toBe('"Broken, urgent"\n');
  });

  it('quotes a value containing a double quote and doubles the quote', () => {
    expect(toCsvRow(['Broken, "urgent"'])).toBe('"Broken, ""urgent"""\n');
  });

  it('quotes a value containing a newline or carriage return', () => {
    expect(toCsvRow(['line one\nline two'])).toBe('"line one\nline two"\n');
    expect(toCsvRow(['line one\r\nline two'])).toBe('"line one\r\nline two"\n');
  });

  it('writes a Date as ISO 8601 UTC without milliseconds', () => {
    expect(toCsvRow([new Date('2026-08-30T14:22:31.123Z')])).toBe(
      '2026-08-30T14:22:31Z\n',
    );
  });

  it('writes null and undefined as empty cells', () => {
    expect(toCsvRow([null, undefined, 'x'])).toBe(',,x\n');
  });

  it('defuses every spreadsheet-injection prefix', () => {
    expect(toCsvRow(['=SUM(A1)'])).toBe("'=SUM(A1)\n");
    expect(toCsvRow(['+1234'])).toBe("'+1234\n");
    expect(toCsvRow(['-1+1'])).toBe("'-1+1\n");
    expect(toCsvRow(['@import'])).toBe("'@import\n");
  });

  it('quotes a defused value that also needs quoting', () => {
    expect(toCsvRow(['=cmd|"/c calc"!A1'])).toBe('"\'=cmd|""/c calc""!A1"\n');
  });

  it('leaves a value that merely contains those characters alone', () => {
    expect(toCsvRow(['a=b', 'x - y'])).toBe('a=b,x - y\n');
  });
});

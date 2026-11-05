import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  isTradingDay,
  nextTradingDay,
  nyDateOf,
  nyLocalToUtc,
  nyseHolidays,
  toNyDate,
  toNyLocal,
  tradingDaysBetween,
  tradingDaysInRange,
  weekday,
} from './dates';

describe('toNyDate', () => {
  it('converts UTC timestamps to the New York calendar date', () => {
    expect(toNyDate('2026-03-10T03:30:00Z')).toBe('2026-03-09'); // EDT, UTC-4
    expect(toNyDate('2026-03-06T04:30:00Z')).toBe('2026-03-05'); // EST, UTC-5
    expect(toNyDate('2026-03-06T05:30:00Z')).toBe('2026-03-06');
    expect(toNyDate('2026-07-01T20:00:00.000Z')).toBe('2026-07-01');
  });

  it('rejects invalid timestamps', () => {
    expect(() => toNyDate('not a date')).toThrow(RangeError);
  });
});

describe('nyDateOf', () => {
  it('passes plain dates through untouched and converts timestamps', () => {
    expect(nyDateOf('2026-03-07')).toBe('2026-03-07');
    expect(nyDateOf('2026-03-10T03:30:00Z')).toBe('2026-03-09');
  });

  it('rejects impossible plain dates', () => {
    expect(() => nyDateOf('2026-02-30')).toThrow(RangeError);
  });
});

describe('plain date arithmetic', () => {
  it('adds and diffs days across month and DST boundaries', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
    expect(addDays('2026-03-08', -1)).toBe('2026-03-07');
    expect(diffDays('2026-03-06', '2026-03-09')).toBe(3);
    expect(diffDays('2026-03-09', '2026-03-06')).toBe(-3);
  });

  it('returns the weekday (0 = Sunday)', () => {
    expect(weekday('2026-11-05')).toBe(4);
    expect(weekday('2026-11-08')).toBe(0);
  });
});

describe('NYSE calendar', () => {
  it('lists the 2026 holidays', () => {
    expect([...nyseHolidays(2026)].sort()).toEqual([
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-04-03', // Good Friday (Easter 2026-04-05)
      '2026-05-25',
      '2026-06-19',
      '2026-07-03', // July 4 is a Saturday -> observed Friday
      '2026-09-07',
      '2026-11-26',
      '2026-12-25',
    ]);
  });

  it('applies observance rules', () => {
    expect(nyseHolidays(2022).has('2021-12-31')).toBe(false); // Sat New Year is not observed
    expect(nyseHolidays(2022).has('2022-01-01')).toBe(false);
    expect(nyseHolidays(2023).has('2023-01-02')).toBe(true); // Sun New Year -> Monday
    expect(nyseHolidays(2021).has('2021-06-18')).toBe(false); // Juneteenth starts 2022
    expect(nyseHolidays(2022).has('2022-06-20')).toBe(true); // Sun -> Monday
    expect(nyseHolidays(2027).has('2027-12-24')).toBe(true); // Sat Christmas -> Friday
    expect(nyseHolidays(2024).has('2024-03-29')).toBe(true); // Good Friday
  });

  it('knows weekends, holidays and special closures', () => {
    expect(isTradingDay('2026-11-05')).toBe(true);
    expect(isTradingDay('2026-11-07')).toBe(false); // Saturday
    expect(isTradingDay('2026-11-26')).toBe(false); // Thanksgiving
    expect(isTradingDay('2025-01-09')).toBe(false); // national day of mourning
  });

  it('finds the next trading day on or after a date', () => {
    expect(nextTradingDay('2026-11-05')).toBe('2026-11-05');
    expect(nextTradingDay('2026-07-03')).toBe('2026-07-06');
  });

  it('lists trading days in an inclusive range', () => {
    expect(tradingDaysInRange('2026-07-01', '2026-07-07')).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-06',
      '2026-07-07',
    ]);
    expect(tradingDaysInRange('2026-07-07', '2026-07-01')).toEqual([]);
  });

  it('counts trading days elapsed after the start date up to the end date', () => {
    expect(tradingDaysBetween('2026-03-02', '2026-03-02')).toBe(0);
    expect(tradingDaysBetween('2026-03-06', '2026-03-09')).toBe(1); // Fri -> Mon
    expect(tradingDaysBetween('2026-07-02', '2026-07-07')).toBe(2); // skips Jul 3 holiday
    expect(tradingDaysBetween('2026-03-09', '2026-03-06')).toBe(0);
  });
});

describe('New York local time <-> UTC', () => {
  it('converts NY wall-clock time to UTC across DST', () => {
    expect(nyLocalToUtc('2026-03-02', '10:00')).toBe('2026-03-02T15:00:00.000Z'); // EST
    expect(nyLocalToUtc('2026-07-01', '09:30')).toBe('2026-07-01T13:30:00.000Z'); // EDT
    expect(nyLocalToUtc('2026-07-01', '09:30:15')).toBe('2026-07-01T13:30:15.000Z');
  });

  it('resolves DST edge cases deterministically', () => {
    // 02:30 does not exist on spring-forward day: shifted forward to 03:30 EDT.
    expect(nyLocalToUtc('2026-03-08', '02:30')).toBe('2026-03-08T07:30:00.000Z');
    // 01:30 happens twice on fall-back day: the first (EDT) occurrence wins.
    expect(nyLocalToUtc('2026-11-01', '01:30')).toBe('2026-11-01T05:30:00.000Z');
  });

  it('rejects malformed input', () => {
    expect(() => nyLocalToUtc('2026-02-30', '10:00')).toThrow(RangeError);
    expect(() => nyLocalToUtc('2026-03-02', '25:00')).toThrow(RangeError);
    expect(() => nyLocalToUtc('2026-03-02', '9:30')).toThrow(RangeError);
  });

  it('formats a UTC timestamp as NY date and time', () => {
    expect(toNyLocal('2026-03-02T15:00:00.000Z')).toEqual({ date: '2026-03-02', time: '10:00' });
    expect(toNyLocal('2026-07-01T03:05:00Z')).toEqual({ date: '2026-06-30', time: '23:05' });
  });

  it('round-trips', () => {
    const { date, time } = toNyLocal('2026-10-14T18:45:00.000Z');
    expect(nyLocalToUtc(date, time)).toBe('2026-10-14T18:45:00.000Z');
  });
});

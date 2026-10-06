import { describe, expect, it } from 'vitest';
import { academicYear, academicYearAt, bucketForDays, gregorianToJalali, jalaliText, jalaliToGregorian, PeriodError, resolvePeriod } from '../src/report/period';

describe('Jalali conversion & academic year', () => {
  it('converts known dates both ways (incl. leap year 1403)', () => {
    expect(jalaliToGregorian(1405, 7, 1)).toEqual({ gy: 2026, gm: 9, gd: 23 });
    expect(jalaliToGregorian(1405, 1, 1)).toEqual({ gy: 2026, gm: 3, gd: 21 });
    expect(jalaliToGregorian(1403, 12, 30)).toEqual({ gy: 2025, gm: 3, gd: 20 });
    expect(gregorianToJalali(2026, 10, 6)).toEqual({ jy: 1405, jm: 7, jd: 14 });
    expect(gregorianToJalali(2025, 3, 21)).toEqual({ jy: 1404, jm: 1, jd: 1 });
  });
  it('academic year runs 1 Mehr → 31 Shahrivar next year, in Tehran local time', () => {
    const y = academicYear(1405);
    expect(y.label).toBe('۱۴۰۵–۱۴۰۶');
    expect(y.from).toBe('2026-09-22T20:30:00.000Z'); // 1 Mehr 1405 00:00 Tehran
    expect(y.to).toBe('2027-09-22T20:30:00.000Z');    // exclusive: 1 Mehr 1406 00:00 Tehran
  });
  it('picks the academic year that contains a date, around the 1 Mehr boundary', () => {
    expect(academicYearAt(new Date('2026-10-06T10:00:00Z')).label).toBe('۱۴۰۵–۱۴۰۶');
    expect(academicYearAt(new Date('2026-05-01T10:00:00Z')).label).toBe('۱۴۰۴–۱۴۰۵');
    expect(academicYearAt(new Date('2026-09-22T20:29:00Z')).label).toBe('۱۴۰۴–۱۴۰۵'); // 31 Shahrivar 23:59 Tehran
    expect(academicYearAt(new Date('2026-09-22T20:30:00Z')).label).toBe('۱۴۰۵–۱۴۰۶'); // 1 Mehr 00:00 Tehran
  });
  it('formats ISO instants as Persian-digit Jalali dates in Tehran time', () => {
    expect(jalaliText('2026-09-22T20:30:00Z')).toBe('۱۴۰۵/۰۷/۰۱');
    expect(jalaliText('2026-09-22T19:29:00Z')).toBe('۱۴۰۵/۰۶/۳۱');
  });
});

describe('resolvePeriod', () => {
  const now = new Date('2026-10-06T10:00:00Z');
  it('relative ranges end at now', () => {
    const p = resolvePeriod({ period: '30d' }, now);
    expect(p.to).toBe(now.toISOString()); expect(p.days).toBe(30); expect(p.label).toBe('۳۰ روز اخیر'); expect(p.academicYear).toBeNull();
  });
  it('current / previous / explicit academic year; the window never reaches into the future', () => {
    const cur = resolvePeriod({ period: 'year_current' }, now);
    expect(cur.academicYear).toBe('۱۴۰۵–۱۴۰۶'); expect(cur.from).toBe('2026-09-22T20:30:00.000Z'); expect(cur.to).toBe(now.toISOString()); expect(cur.toJalali).toBe('۱۴۰۶/۰۶/۳۱');
    const prev = resolvePeriod({ period: 'year_previous' }, now);
    expect(prev.academicYear).toBe('۱۴۰۴–۱۴۰۵'); expect(prev.to).toBe('2026-09-22T20:30:00.000Z'); expect(prev.label).toBe('سال تحصیلی ۱۴۰۴–۱۴۰۵');
    expect(resolvePeriod({ period: 'year', year: 1404 }, now).from).toBe(prev.from);
    expect(() => resolvePeriod({ period: 'year', year: 1406 }, now)).toThrow(PeriodError);
  });
  it('custom range uses Tehran calendar days, inclusive of the last day, and is validated', () => {
    const p = resolvePeriod({ period: 'custom', from: '2026-01-01', to: '2026-01-31' }, now);
    expect(p.from).toBe('2025-12-31T20:30:00.000Z'); expect(p.to).toBe('2026-01-31T20:30:00.000Z'); expect(p.days).toBe(31);
    expect(() => resolvePeriod({ period: 'custom', from: '2026-02-01', to: '2026-01-01' }, now)).toThrow(PeriodError);
    expect(() => resolvePeriod({ period: 'custom', from: '2026-02-30', to: '2026-03-01' }, now)).toThrow(PeriodError);
    expect(() => resolvePeriod({ period: 'custom' }, now)).toThrow(PeriodError);
    expect(() => resolvePeriod({ period: 'custom', from: '2020-01-01', to: '2026-01-01' }, now)).toThrow(PeriodError);
  });
  it('chooses a readable chart bucket from the span', () => {
    expect(bucketForDays(7)).toBe('day'); expect(bucketForDays(90)).toBe('week'); expect(bucketForDays(365)).toBe('week'); expect(bucketForDays(800)).toBe('four_weeks');
  });
});

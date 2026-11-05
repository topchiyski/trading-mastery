import { describe, expect, it } from 'vitest';
import { toMicros as $ } from './money';
import { initialRisk, plannedRewardRisk, rMultiple } from './risk';

const firstEntry = { price: $('50'), quantity: 100 };

describe('initialRisk', () => {
  it('is (first entry price − initial stop) × first entry quantity', () => {
    // (50 − 48) × 100 = 200
    expect(initialRisk(firstEntry, { initialStop: $('48') })).toBe($('200'));
  });

  it('uses only the first fill even when the trade scaled in', () => {
    // Scale-in example: first fill 100 @ 10, stop 9.50 -> 0.50 × 100 = 50
    expect(initialRisk({ price: $('10'), quantity: 100 }, { initialStop: $('9.5') })).toBe($('50'));
  });

  it('prefers an explicit planned-risk override', () => {
    expect(initialRisk(firstEntry, { initialStop: $('48'), plannedRiskOverride: $('300') })).toBe(
      $('300'),
    );
    expect(initialRisk(firstEntry, { plannedRiskOverride: $('300') })).toBe($('300'));
  });

  it('is null without a stop, or with a stop at/above entry', () => {
    expect(initialRisk(firstEntry, {})).toBeNull();
    expect(initialRisk(firstEntry, { initialStop: null })).toBeNull();
    expect(initialRisk(firstEntry, { initialStop: $('50') })).toBeNull();
    expect(initialRisk(firstEntry, { initialStop: $('51') })).toBeNull();
    expect(initialRisk(firstEntry, { initialStop: $('48'), plannedRiskOverride: 0 })).toBe(
      $('200'),
    );
  });
});

describe('rMultiple', () => {
  it('is net P&L ÷ initial risk', () => {
    expect(rMultiple($('498'), $('200'))).toBeCloseTo(2.49, 10);
    expect(rMultiple($('-202'), $('100'))).toBeCloseTo(-2.02, 10);
    expect(rMultiple($('697.5'), $('50'))).toBeCloseTo(13.95, 10);
    expect(rMultiple($('697.5'), $('300'))).toBeCloseTo(2.325, 10);
  });

  it('is null when risk or P&L is unknown', () => {
    expect(rMultiple($('100'), null)).toBeNull();
    expect(rMultiple(null, $('100'))).toBeNull();
  });
});

describe('plannedRewardRisk', () => {
  it('is (target − entry) ÷ (entry − stop)', () => {
    expect(plannedRewardRisk($('50'), $('48'), $('56'))).toBe(3);
  });

  it('is null when stop or target is missing or the stop is not below entry', () => {
    expect(plannedRewardRisk($('50'), null, $('56'))).toBeNull();
    expect(plannedRewardRisk($('50'), $('48'), null)).toBeNull();
    expect(plannedRewardRisk($('50'), $('50'), $('56'))).toBeNull();
  });
});

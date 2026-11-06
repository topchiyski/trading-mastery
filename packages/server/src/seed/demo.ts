/**
 * Deterministic demo data: ~40 trades (28 generated + 14 hand-written edge cases),
 * tags, stops, journal text, cash flows and settings. Goes through the repository
 * layer so it obeys the same validation and regrouping rules as the API.
 */
import { toMicros, toQuantity as sh, tradingDaysInRange } from '@tj/core';
import { count } from 'drizzle-orm';
import type { Db } from '../db/client';
import { executions } from '../db/schema';
import { createCashFlow } from '../repo/cash-flows';
import { createExecution } from '../repo/executions';
import { updateSettings } from '../repo/settings';
import { addStop } from '../repo/stops';
import { createTag } from '../repo/tags';
import {
  addFill,
  createTrade,
  setTradeTags,
  updateJournal,
  type JournalPatch,
} from '../repo/trades';

const $ = toMicros;
/** UTC timestamp on a date. 14:45Z is after the open all year; 19:30Z before the close. */
const ts = (date: string, hhmm = '14:45') => `${date}T${hhmm}:00.000Z`;

/** Small deterministic PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SETUPS = ['Breakout', 'Pullback', 'Base breakout', 'Earnings gap'] as const;
const MISTAKES = ['Chased entry', 'Moved stop', 'Oversized', 'Early exit', 'No plan'] as const;
const CUSTOM = ['A+ setup', 'Weak market'] as const;
const COLORS: Record<string, string> = {
  Breakout: '#22c55e',
  Pullback: '#3b82f6',
  'Base breakout': '#a855f7',
  'Earnings gap': '#f59e0b',
};

const GENERATED_SYMBOLS = [
  'AAPL',
  'AMZN',
  'GOOGL',
  'MSFT',
  'LLY',
  'COST',
  'CAT',
  'DE',
  'UBER',
  'SHOP',
  'PANW',
  'CRWD',
  'ANET',
  'NOW',
];

const WIN_REVIEWS = [
  'Followed the plan, sold into strength.',
  'Held through the first pullback as planned; good patience.',
  'Clean entry off the pivot; trimmed at target.',
  'Market tailwind helped. Size was right.',
];
const LOSS_REVIEWS = [
  'Stopped out at the planned level. Valid setup, just did not work.',
  'Entered extended from the pivot; should have waited.',
  'Market turned the day after entry. Stop did its job.',
  'Volume never confirmed; exit was correct.',
];

export function seedDemo(db: Db): { trades: number } {
  const existing = db.select({ n: count() }).from(executions).get()?.n ?? 0;
  if (existing > 0) {
    throw new Error('Database is not empty; refusing to seed (run with --force to wipe it first).');
  }

  updateSettings(db, {
    startingBalance: $('25000'),
    startDate: '2025-07-01',
    breakEvenThreshold: $('1'),
    defaultCommission: $('1'),
  });

  const tagId = new Map<string, number>();
  for (const name of SETUPS)
    tagId.set(name, createTag(db, { name, kind: 'SETUP', color: COLORS[name] }).id);
  for (const name of MISTAKES)
    tagId.set(name, createTag(db, { name, kind: 'MISTAKE', color: '#ef4444' }).id);
  for (const name of CUSTOM) tagId.set(name, createTag(db, { name, kind: 'CUSTOM' }).id);
  const tag = (name: string) => tagId.get(name) as number;

  let tradeCount = 0;

  // -------------------------------------------------------------------------
  // 28 generated "normal" trades, Jul 2025 – May 2026.
  const rand = prng(20250701);
  const days = tradingDaysInRange('2025-07-01', '2026-06-30');
  const basePrice = new Map(GENERATED_SYMBOLS.map((s) => [s, 40 + Math.round(rand() * 560)]));

  for (let i = 0; i < 28; i++) {
    const symbol = GENERATED_SYMBOLS[i % GENERATED_SYMBOLS.length] as string;
    const entryIdx = 2 + i * 8;
    const hold = 2 + Math.floor(rand() * 11);
    const entryDay = days[entryIdx] as string;
    const exitDay = days[entryIdx + hold] as string;

    const entryCents = Math.round((basePrice.get(symbol) as number) * (0.9 + rand() * 0.3) * 100);
    const stopPct = 0.03 + rand() * 0.05;
    const stopCents = Math.round(entryCents * (1 - stopPct));
    const riskCents = entryCents - stopCents;
    const qty = Math.max(1, Math.floor(25_000 / riskCents)); // ≈ $250 risk
    const win = rand() < 0.45;
    const r = win ? 0.6 + rand() * 2.9 : -(0.3 + rand() * 0.9);
    const exitCents = Math.max(1, Math.round(entryCents + r * riskCents));
    const cents = (c: number) => c * 10_000;

    const setup = SETUPS[i % SETUPS.length] as string;
    const trade = createTrade(db, {
      symbol,
      fill: {
        quantity: sh(qty),
        price: cents(entryCents),
        commission: $('1'),
        otherFees: 0,
        executedAt: ts(entryDay),
      },
      initialStop: cents(stopCents),
      target: cents(entryCents + 3 * riskCents),
      setupTagId: tag(setup),
      thesis: `${setup} in ${symbol}; risk ${(stopPct * 100).toFixed(1)}% to the stop.`,
    });

    if (i % 4 === 1 && hold >= 4) {
      // Scale out in two parts.
      const half = Math.floor(qty / 2);
      const midDay = days[entryIdx + Math.floor(hold / 2)] as string;
      const firstCents = Math.max(1, Math.round(entryCents + r * 0.6 * riskCents));
      addFill(db, trade.id, {
        side: 'SELL',
        quantity: sh(half),
        price: cents(firstCents),
        commission: $('1'),
        otherFees: $('0.02'),
        executedAt: ts(midDay, '19:30'),
      });
      addFill(db, trade.id, {
        side: 'SELL',
        quantity: sh(qty - half),
        price: cents(exitCents),
        commission: $('1'),
        otherFees: $('0.02'),
        executedAt: ts(exitDay, '19:30'),
      });
    } else {
      addFill(db, trade.id, {
        side: 'SELL',
        quantity: sh(qty),
        price: cents(exitCents),
        commission: $('1'),
        otherFees: $('0.03'),
        executedAt: ts(exitDay, '19:30'),
      });
    }

    const reviews = win ? WIN_REVIEWS : LOSS_REVIEWS;
    const journal: JournalPatch = {
      review: reviews[i % reviews.length] as string,
      emotion: win ? (i % 3 === 0 ? 'confident' : 'calm') : i % 3 === 0 ? 'frustrated' : 'calm',
      executionRating: win ? 3 + (i % 3) : 1 + (i % 3),
      followedPlan: win || i % 3 !== 0,
    };
    updateJournal(db, trade.id, journal);
    const tagsForTrade: number[] = [];
    if (!win && i % 3 === 0) tagsForTrade.push(tag(MISTAKES[i % MISTAKES.length] as string));
    if (win && r > 2) tagsForTrade.push(tag('A+ setup'));
    if (i >= 12 && i <= 15) tagsForTrade.push(tag('Weak market'));
    if (tagsForTrade.length) setTradeTags(db, trade.id, tagsForTrade);
    tradeCount++;
  }

  // -------------------------------------------------------------------------
  // Hand-written edge cases.
  const edge = (
    symbol: string,
    first: { qty: number; price: string; at: string; commission?: string; otherFees?: string },
    more: {
      side: 'BUY' | 'SELL';
      qty: number;
      price: string;
      at: string;
      commission?: string;
      otherFees?: string;
    }[],
    journal: JournalPatch & { setup?: string; tags?: string[] } = {},
  ) => {
    const { setup, tags = [], ...rest } = journal;
    const trade = createTrade(db, {
      symbol,
      fill: {
        quantity: sh(first.qty),
        price: $(first.price),
        commission: $(first.commission ?? '1'),
        otherFees: $(first.otherFees ?? '0'),
        executedAt: first.at,
      },
      initialStop: rest.initialStop ?? null,
      target: rest.target ?? null,
      plannedRiskOverride: rest.plannedRiskOverride ?? null,
      setupTagId: setup ? tag(setup) : null,
      thesis: rest.thesis ?? null,
    });
    for (const f of more) {
      addFill(db, trade.id, {
        side: f.side,
        quantity: sh(f.qty),
        price: $(f.price),
        commission: $(f.commission ?? '1'),
        otherFees: $(f.otherFees ?? '0'),
        executedAt: f.at,
      });
    }
    updateJournal(db, trade.id, {
      review: rest.review,
      emotion: rest.emotion,
      executionRating: rest.executionRating,
      followedPlan: rest.followedPlan,
    });
    if (tags.length) setTradeTags(db, trade.id, tags.map(tag));
    tradeCount++;
    return trade.id;
  };

  // Scale-in with 3 fills, single exit.
  edge(
    'AMD',
    { qty: 100, price: '160', at: ts('2026-01-05') },
    [
      { side: 'BUY', qty: 100, price: '164.50', at: ts('2026-01-06') },
      { side: 'BUY', qty: 50, price: '168.20', at: ts('2026-01-07') },
      { side: 'SELL', qty: 250, price: '175.40', at: ts('2026-01-14', '19:30') },
    ],
    {
      setup: 'Base breakout',
      initialStop: $('154'),
      target: $('180'),
      thesis: 'Pyramiding into a base breakout.',
      review: 'Adds worked; avg cost stayed below the pivot.',
      executionRating: 5,
      followedPlan: true,
      tags: ['A+ setup'],
    },
  );

  // Single entry, 3 scale-outs (last one stopped).
  edge(
    'META',
    { qty: 60, price: '610', at: ts('2026-01-12') },
    [
      { side: 'SELL', qty: 20, price: '640', at: ts('2026-01-20', '19:30') },
      { side: 'SELL', qty: 20, price: '655', at: ts('2026-01-23', '19:30') },
      { side: 'SELL', qty: 20, price: '602', at: ts('2026-01-28', '19:30') },
    ],
    {
      setup: 'Pullback',
      initialStop: $('590'),
      target: $('660'),
      review: 'Thirds out; final third gave back gains.',
      executionRating: 4,
      followedPlan: true,
    },
  );

  // Interleaved scale-in and scale-out.
  edge(
    'TSLA',
    { qty: 50, price: '240', at: ts('2026-02-02') },
    [
      { side: 'SELL', qty: 25, price: '252', at: ts('2026-02-04', '19:30') },
      { side: 'BUY', qty: 40, price: '248', at: ts('2026-02-05') },
      { side: 'SELL', qty: 65, price: '238', at: ts('2026-02-10', '19:30') },
    ],
    {
      setup: 'Breakout',
      initialStop: $('228'),
      review: 'Re-bought too high after trimming.',
      executionRating: 2,
      followedPlan: false,
      tags: ['Chased entry'],
    },
  );

  // Fees turn a gross win into a net loss.
  edge(
    'KO',
    { qty: 300, price: '62.00', at: ts('2026-02-18'), commission: '3.50', otherFees: '0.30' },
    [
      {
        side: 'SELL',
        qty: 300,
        price: '62.02',
        at: ts('2026-02-20', '19:30'),
        commission: '3.50',
        otherFees: '0.30',
      },
    ],
    {
      setup: 'Pullback',
      initialStop: $('60.50'),
      review: 'Scratch trade; fees made it a loss.',
      executionRating: 3,
      followedPlan: true,
    },
  );

  // Break-even (net exactly 0).
  edge(
    'PEP',
    { qty: 100, price: '150.00', at: ts('2026-02-24') },
    [{ side: 'SELL', qty: 100, price: '150.02', at: ts('2026-02-25', '19:30') }],
    {
      setup: 'Breakout',
      initialStop: $('146'),
      review: 'Failed breakout, scratched it.',
      executionRating: 4,
      followedPlan: true,
    },
  );

  // No stop: loss and win (both excluded from R).
  edge(
    'XOM',
    { qty: 80, price: '115', at: ts('2026-03-02') },
    [{ side: 'SELL', qty: 80, price: '109.50', at: ts('2026-03-06', '19:30') }],
    {
      review: 'No stop, no plan. Impulse trade.',
      emotion: 'impulsive',
      executionRating: 1,
      followedPlan: false,
      tags: ['No plan'],
    },
  );
  edge(
    'JPM',
    { qty: 40, price: '300', at: ts('2026-03-09') },
    [{ side: 'SELL', qty: 40, price: '318', at: ts('2026-03-20', '19:30') }],
    {
      setup: 'Pullback',
      review: 'Worked, but I never set a stop.',
      executionRating: 3,
      followedPlan: false,
    },
  );

  // Same-timestamp fills, ordered by broker execution id.
  const crmBuy = createExecution(db, {
    symbol: 'CRM',
    side: 'BUY',
    quantity: sh(50),
    price: $('270.12'),
    commission: $('0.5'),
    otherFees: 0,
    executedAt: ts('2026-03-23'),
    externalId: 'DEMO.CRM.0002',
  });
  createExecution(db, {
    symbol: 'CRM',
    side: 'BUY',
    quantity: sh(50),
    price: $('270.10'),
    commission: $('0.5'),
    otherFees: 0,
    executedAt: ts('2026-03-23'),
    externalId: 'DEMO.CRM.0001',
  });
  createExecution(db, {
    symbol: 'CRM',
    side: 'SELL',
    quantity: sh(100),
    price: $('281'),
    commission: $('1'),
    otherFees: $('0.03'),
    executedAt: ts('2026-04-01', '19:30'),
    externalId: 'DEMO.CRM.0003',
  });
  updateJournal(db, crmBuy.tradeId, {
    setupTagId: tag('Earnings gap'),
    initialStop: $('262'),
    thesis: 'Gap and go after earnings; order filled in two pieces.',
    review: 'Partial fills at the same second.',
    executionRating: 4,
    followedPlan: true,
  });
  tradeCount++;

  // Planned scale-in with an explicit planned-risk override.
  edge(
    'NFLX',
    { qty: 20, price: '900', at: ts('2026-04-06') },
    [
      { side: 'BUY', qty: 20, price: '930', at: ts('2026-04-08') },
      { side: 'SELL', qty: 40, price: '960', at: ts('2026-04-21', '19:30') },
    ],
    {
      setup: 'Breakout',
      initialStop: $('870'),
      plannedRiskOverride: $('1000'),
      review: 'Planned half size first, add on confirmation.',
      executionRating: 4,
      followedPlan: true,
    },
  );

  // Trailing stops.
  const avgo = edge(
    'AVGO',
    { qty: 30, price: '330', at: ts('2026-04-13') },
    [{ side: 'SELL', qty: 30, price: '352', at: ts('2026-04-27', '19:30') }],
    {
      setup: 'Base breakout',
      initialStop: $('315'),
      target: $('370'),
      review: 'Trailed the stop up; stopped out with profit.',
      executionRating: 5,
      followedPlan: true,
    },
  );
  addStop(db, avgo, { stopPrice: $('325'), changedAt: ts('2026-04-16', '20:30') });
  addStop(db, avgo, { stopPrice: $('340'), changedAt: ts('2026-04-21', '20:30') });
  addStop(db, avgo, { stopPrice: $('352'), changedAt: ts('2026-04-24', '20:30') });

  // Big loser: moved the stop down, oversized.
  const smci = edge(
    'SMCI',
    { qty: 200, price: '45', at: ts('2026-05-04') },
    [{ side: 'SELL', qty: 200, price: '40', at: ts('2026-05-08', '19:30') }],
    {
      setup: 'Earnings gap',
      initialStop: $('43'),
      review: 'Moved my stop and doubled the loss.',
      emotion: 'fearful',
      executionRating: 1,
      followedPlan: false,
      tags: ['Moved stop', 'Oversized'],
    },
  );
  addStop(db, smci, { stopPrice: $('41'), changedAt: ts('2026-05-06', '15:30') });

  // Fractional shares: 0.5 + 0.25 in, 0.75 out.
  edge(
    'COIN',
    { qty: 0.5, price: '284.10', at: ts('2026-05-18'), commission: '0.35' },
    [
      { side: 'BUY', qty: 0.25, price: '280', at: ts('2026-05-19'), commission: '0.35' },
      { side: 'SELL', qty: 0.75, price: '291', at: ts('2026-05-26', '19:30'), commission: '0.35' },
    ],
    {
      setup: 'Pullback',
      initialStop: $('270'),
      review: 'Small fractional position while testing the setup.',
      executionRating: 3,
      followedPlan: true,
    },
  );

  // Same-day trade (0 days held).
  edge(
    'SPY',
    { qty: 50, price: '600', at: ts('2026-05-13', '14:40') },
    [{ side: 'SELL', qty: 50, price: '603', at: ts('2026-05-13', '19:50') }],
    {
      setup: 'Pullback',
      initialStop: $('597'),
      review: 'Intraday scalp, out the same day.',
      executionRating: 3,
      followedPlan: true,
    },
  );

  // Open trades: one with a partial exit and a trailing stop, one fresh.
  const nvda = edge(
    'NVDA',
    { qty: 100, price: '180', at: ts('2026-10-14') },
    [{ side: 'SELL', qty: 30, price: '196', at: ts('2026-10-28', '19:30') }],
    {
      setup: 'Breakout',
      initialStop: $('172'),
      target: $('210'),
      thesis: 'Breakout from a 7-week base.',
    },
  );
  addStop(db, nvda, { stopPrice: $('182'), changedAt: ts('2026-10-28', '20:30') });
  edge('ORCL', { qty: 40, price: '250', at: ts('2026-10-26') }, [], {
    setup: 'Pullback',
    initialStop: $('238'),
    target: $('285'),
    thesis: 'Pullback to the 21-day EMA.',
  });

  // -------------------------------------------------------------------------
  // Cash flows.
  const flows = [
    { type: 'INTEREST', amount: '8.12', occurredAt: '2025-07-31' },
    { type: 'DIVIDEND', amount: '12.40', occurredAt: '2025-08-14' },
    { type: 'INTEREST', amount: '9.05', occurredAt: '2025-08-29' },
    { type: 'FEE', amount: '-10', occurredAt: '2025-09-30', note: 'Market data subscription' },
    { type: 'DEPOSIT', amount: '10000', occurredAt: '2025-10-01', note: 'Added capital' },
    { type: 'INTEREST', amount: '14.70', occurredAt: '2025-10-31' },
    { type: 'WITHDRAWAL', amount: '-3000', occurredAt: '2026-02-02', note: 'Tax payment' },
    { type: 'INTEREST', amount: '12.33', occurredAt: '2026-03-31' },
    { type: 'DIVIDEND', amount: '18.20', occurredAt: '2026-05-15' },
  ] as const;
  for (const f of flows) {
    createCashFlow(db, {
      type: f.type,
      amount: $(f.amount),
      occurredAt: f.occurredAt,
      note: 'note' in f ? f.note : null,
    });
  }

  return { trades: tradeCount };
}

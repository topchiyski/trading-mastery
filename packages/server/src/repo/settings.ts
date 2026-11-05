import { DEFAULT_BREAK_EVEN_THRESHOLD } from '@tj/core';
import { z } from 'zod';
import type { DbOrTx } from '../db/client';
import { settings } from '../db/schema';
import type { Patch } from '../errors';
import { nonNegativeMicros, plainDate } from '../validation';

export const settingsSchema = z.object({
  /** Account balance on the start date, in micros. */
  startingBalance: nonNegativeMicros,
  /** First day of the equity curve; null = date of the first trade/cash flow. */
  startDate: plainDate.nullable(),
  breakEvenThreshold: nonNegativeMicros,
  /** Pre-filled on the manual entry form. */
  defaultCommission: nonNegativeMicros,
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsPatchSchema = settingsSchema.partial().strict();

export const DEFAULT_SETTINGS: Settings = {
  startingBalance: 0,
  startDate: null,
  breakEvenThreshold: DEFAULT_BREAK_EVEN_THRESHOLD,
  defaultCommission: 0,
};

export function getSettings(db: DbOrTx): Settings {
  const stored: Record<string, unknown> = {};
  for (const row of db.select().from(settings).all()) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      // ignore unreadable values; defaults apply
    }
  }
  const result = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const parsed = settingsSchema.shape[key].safeParse(stored[key]);
    if (key in stored && parsed.success) Object.assign(result, { [key]: parsed.data });
  }
  return result;
}

export function updateSettings(db: DbOrTx, patch: Patch<Settings>): Settings {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const json = JSON.stringify(value);
    db.insert(settings)
      .values({ key, value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json } })
      .run();
  }
  return getSettings(db);
}

import { describe, expect, it } from 'vitest';
import { isNewTradeShortcut, resolveTheme } from './shortcuts';

const key = (k: string, target: Partial<HTMLElement> | null, mods: Partial<KeyboardEvent> = {}) =>
  ({
    key: k,
    target,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  }) as unknown as KeyboardEvent;

describe('isNewTradeShortcut', () => {
  it('fires on a plain "n" outside form fields', () => {
    expect(isNewTradeShortcut(key('n', { tagName: 'BODY' }))).toBe(true);
    expect(isNewTradeShortcut(key('n', { tagName: 'BUTTON' }))).toBe(true);
  });

  it('never fires while typing or with modifiers', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isNewTradeShortcut(key('n', { tagName }))).toBe(false);
    }
    expect(isNewTradeShortcut(key('n', { tagName: 'DIV', isContentEditable: true }))).toBe(false);
    expect(isNewTradeShortcut(key('n', { tagName: 'BODY' }, { ctrlKey: true }))).toBe(false);
    expect(isNewTradeShortcut(key('n', { tagName: 'BODY' }, { metaKey: true }))).toBe(false);
    expect(isNewTradeShortcut(key('N', { tagName: 'BODY' }))).toBe(false); // shift+n
    expect(isNewTradeShortcut(key('m', { tagName: 'BODY' }))).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('uses the stored choice, else the OS preference', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme('bogus', false)).toBe('light');
  });
});

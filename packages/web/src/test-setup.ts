import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no layout: charts measure their container with ResizeObserver.
class FixedSizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element) {
    this.cb(
      [{ target, contentRect: { width: 800, height: 300 } } as unknown as ResizeObserverEntry],
      this as never,
    );
  }
  unobserve() {}
  disconnect() {}
}
// A plain assignment: tests call vi.unstubAllGlobals(), which must not remove it.
globalThis.ResizeObserver = FixedSizeObserver as unknown as typeof ResizeObserver;

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

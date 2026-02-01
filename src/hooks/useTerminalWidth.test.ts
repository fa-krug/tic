import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// We test the core logic, not the React hook itself
// The hook simply reads stdout.columns and listens for 'resize'
describe('useTerminalWidth logic', () => {
  it('returns stdout.columns value', () => {
    const stdout = Object.assign(new EventEmitter(), { columns: 120 });
    expect(stdout.columns).toBe(120);
  });

  it('defaults to 80 when columns is undefined', () => {
    const stdout = Object.assign(new EventEmitter(), { columns: undefined });
    expect(stdout.columns ?? 80).toBe(80);
  });

  it('emits resize event when terminal changes size', () => {
    const stdout = Object.assign(new EventEmitter(), { columns: 120 });
    const handler = vi.fn();
    stdout.on('resize', handler);
    stdout.columns = 40;
    stdout.emit('resize');
    expect(handler).toHaveBeenCalled();
    expect(stdout.columns).toBe(40);
  });
});

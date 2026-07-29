import type { EventEmitter } from 'node:events';
import { useStdin } from 'ink';

/**
 * Ink 7 narrowed the public type of `useStdin()` to omit
 * `internal_eventEmitter`, but the raw-input emitter is still placed on the
 * stdin context at runtime (Ink itself reads it via the unexported
 * `useStdinContext`, and `ink` publishes no subpath exports to reach it).
 *
 * Hooks that need escape sequences Ink doesn't surface through `useInput` —
 * SGR mouse reports, Page Up/Down, forward delete — go through here so the
 * cast lives in exactly one place.
 */
export function useInkInputEmitter(): EventEmitter | undefined {
  const stdin = useStdin() as { internal_eventEmitter?: EventEmitter };
  return stdin.internal_eventEmitter;
}

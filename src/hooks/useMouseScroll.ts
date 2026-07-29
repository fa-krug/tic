import { useEffect, useRef } from 'react';
import { useInkInputEmitter } from './useInkInputEmitter.js';

/**
 * Enable terminal mouse wheel tracking and call `onScroll` when the user
 * scrolls up or down.  Uses SGR-1006 extended mouse encoding so that
 * coordinates > 223 work correctly.
 *
 * Only wheel events (buttons 64/65) are reported; clicks are ignored.
 *
 * Cleanup restores the terminal to its previous mouse state on unmount.
 */
export function useMouseScroll(
  onScroll: (direction: 'up' | 'down') => void,
  active = true,
): void {
  const internal_eventEmitter = useInkInputEmitter();

  useEffect(() => {
    if (!active) return;

    // Enable SGR-1006 mouse tracking (button-event mode so wheel is captured)
    const ENABLE =
      '\x1b[?1000h' + // basic mouse tracking
      '\x1b[?1006h'; // SGR extended encoding
    const DISABLE =
      '\x1b[?1000l' + // disable basic mouse tracking
      '\x1b[?1006l'; // disable SGR encoding

    process.stdout.write(ENABLE);

    // SGR mouse sequences: ESC[<button;x;yM (press) or ESC[<button;x;ym (release)
    // Wheel up: button = 64, Wheel down: button = 65
    // eslint-disable-next-line no-control-regex
    const sgrRegex = /\x1b\[<(\d+);\d+;\d+[Mm]/g;

    const handler = (data: string) => {
      let match: RegExpExecArray | null;
      sgrRegex.lastIndex = 0;
      while ((match = sgrRegex.exec(data)) !== null) {
        const button = Number(match[1]);
        if (button === 64) onScroll('up');
        else if (button === 65) onScroll('down');
      }
    };

    internal_eventEmitter?.on('input', handler);

    return () => {
      internal_eventEmitter?.removeListener('input', handler);
      process.stdout.write(DISABLE);
    };
  }, [active, internal_eventEmitter, onScroll]);
}

/**
 * Detect Page Up / Page Down keypresses via raw stdin.
 *
 * Ink doesn't use the alternate screen buffer, so many terminals consume
 * Page Up/Down for scrollback.  When they *do* arrive they come as
 * `ESC[5~` (Page Up) and `ESC[6~` (Page Down).  This hook sets a ref that
 * can be read from a `useInput` handler.
 */
export function usePageKeys(active = true): React.RefObject<{
  pageUp: boolean;
  pageDown: boolean;
}> {
  const ref = useRef({ pageUp: false, pageDown: false });
  const internal_eventEmitter = useInkInputEmitter();

  useEffect(() => {
    if (!active) return;

    const handler = (data: string) => {
      if (data === '\x1b[5~') ref.current.pageUp = true;
      if (data === '\x1b[6~') ref.current.pageDown = true;
    };

    internal_eventEmitter?.on('input', handler);
    return () => {
      internal_eventEmitter?.removeListener('input', handler);
    };
  }, [active, internal_eventEmitter]);

  return ref;
}

import { useEffect, useRef } from 'react';
import { useStdin } from 'ink';

/**
 * Ink 6 maps both the physical Backspace key (\x7f) and the Delete key
 * (\x1b[3~) to `key.delete` in useInput, making them indistinguishable.
 *
 * This hook listens to raw stdin data via Ink's internal event emitter
 * and sets a ref flag when the Delete key escape sequence is detected.
 * The ref should be read inside a useInput handler when `key.delete` is
 * true, then reset to false after use.
 */
export function useForwardDelete(active = true): React.RefObject<boolean> {
  const isForwardDeleteRef = useRef(false);
  const { internal_eventEmitter } = useStdin();

  useEffect(() => {
    if (!active) return;

    const handler = (data: string) => {
      // \x1b[3~ is the standard escape sequence for the Delete key.
      // \x1b[3;5~ is Ctrl+Delete, \x1b[3;2~ is Shift+Delete, etc.
      isForwardDeleteRef.current =
        data === '\x1b[3~' ||
        (data.startsWith('\x1b[3;') && data.endsWith('~'));
    };

    // Register BEFORE useInput's listener so the ref is set by the time
    // the useInput callback reads it.
    internal_eventEmitter?.on('input', handler);
    return () => {
      internal_eventEmitter?.removeListener('input', handler);
    };
  }, [active, internal_eventEmitter]);

  return isForwardDeleteRef;
}

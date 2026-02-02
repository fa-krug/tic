import { useState, useEffect } from 'react';
import { useStdout } from 'ink';

export function useTerminalSize(): { width: number; height: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    width: stdout.columns || 80,
    height: stdout.rows || 24,
  });

  useEffect(() => {
    const onResize = () => {
      setSize({
        width: stdout.columns || 80,
        height: stdout.rows || 24,
      });
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return size;
}

import { useState, useEffect } from 'react';
import { useStdout } from 'ink';

export function useTerminalWidth(): number {
  const { stdout } = useStdout();
  const [width, setWidth] = useState(stdout.columns || 80);

  useEffect(() => {
    const onResize = () => {
      setWidth(stdout.columns || 80);
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return width;
}

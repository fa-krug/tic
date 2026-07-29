import { describe, it, expect, beforeEach } from 'vitest';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { TableLayout } from './TableLayout.js';
import type { ColumnDef } from './TableLayout.js';
import { themeStore, themes } from '../stores/themeStore.js';

interface Row {
  id: string;
}

const rows: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

const DEFAULT_COLORS = themes['default']!;

/**
 * Renders the table and returns the `rowBg` each row's column render callback
 * was handed, keyed by row id.
 */
function capturedRowBgs(opts: {
  cursor: number;
  isMarked?: (row: Row) => boolean;
}): Record<string, string | undefined> {
  const seen: Record<string, string | undefined> = {};
  const columns: ColumnDef<Row>[] = [
    {
      key: 'id',
      header: 'ID',
      width: -1,
      required: true,
      render: (row, _selected, rowBg) => {
        seen[row.id] = rowBg;
        return <Text>{row.id}</Text>;
      },
    },
  ];
  render(
    <TableLayout
      items={rows}
      columns={columns}
      cursor={opts.cursor}
      terminalWidth={80}
      getKey={(row) => row.id}
      isMarked={opts.isMarked}
    />,
  );
  return seen;
}

describe('TableLayout row background', () => {
  beforeEach(() => {
    themeStore.setState({
      themeName: 'default',
      colors: { ...DEFAULT_COLORS },
    });
  });

  it('passes no background for a plain row', () => {
    const seen = capturedRowBgs({ cursor: 0 });
    expect(seen['b']).toBeUndefined();
    expect(seen['c']).toBeUndefined();
  });

  it('passes selectionBg for the row under the cursor', () => {
    const seen = capturedRowBgs({ cursor: 1 });
    expect(seen['b']).toBe(DEFAULT_COLORS.selectionBg);
  });

  it('passes accentBg for a marked row that is not selected', () => {
    const seen = capturedRowBgs({
      cursor: 0,
      isMarked: (row) => row.id === 'c',
    });
    expect(seen['c']).toBe(DEFAULT_COLORS.accentBg);
  });

  it('passes selectedMarkedBg when the cursor is on a marked row', () => {
    const seen = capturedRowBgs({
      cursor: 2,
      isMarked: (row) => row.id === 'c',
    });
    expect(seen['c']).toBe(DEFAULT_COLORS.selectedMarkedBg);
    // The same row must not report the plain selection background, which is
    // what columns used to assume.
    expect(seen['c']).not.toBe(DEFAULT_COLORS.selectionBg);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { ColorPill } from './ColorPill.js';
import { themeStore } from '../stores/themeStore.js';

describe('ColorPill', () => {
  beforeEach(() => {
    themeStore.setState({
      themeName: 'default',
      colorOverrides: {},
    });
  });

  it('renders pill with color for matched value', () => {
    const { lastFrame } = render(<ColorPill field="status" value="done" />);
    expect(lastFrame()).toContain('done');
  });

  it('renders plain text for unmatched value', () => {
    const { lastFrame } = render(
      <ColorPill field="status" value="unknown-xyz" />,
    );
    expect(lastFrame()).toContain('unknown-xyz');
  });

  it('renders the value when placed on a selection background', () => {
    const { lastFrame } = render(
      <ColorPill field="status" value="design" selectionBg="cyanBright" />,
    );
    expect(lastFrame()).toContain('design');
  });
});

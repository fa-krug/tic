import { describe, it, expect, beforeEach } from 'vitest';
import { themeStore, autoFg, themes } from './themeStore.js';

describe('themeStore resolveFieldColor', () => {
  beforeEach(() => {
    themeStore.setState({
      themeName: 'default',
      colorOverrides: {},
    });
  });

  describe('keyword defaults', () => {
    it('returns green for "done" status', () => {
      const result = themeStore.getState().resolveFieldColor('status', 'done');
      expect(result).toEqual({ bg: 'green', fg: 'white' });
    });

    it('matches case-insensitively', () => {
      const result = themeStore.getState().resolveFieldColor('status', 'Done');
      expect(result).toEqual({ bg: 'green', fg: 'white' });
    });

    it('matches via contains ("In Progress" matches "progress")', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('status', 'In Progress');
      expect(result).toEqual({ bg: 'blue', fg: 'white' });
    });

    it('returns red for "critical" priority', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('priority', 'critical');
      expect(result).toEqual({ bg: 'red', fg: 'white' });
    });

    it('returns yellow/black for "high" priority', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('priority', 'high');
      expect(result).toEqual({ bg: 'yellow', fg: 'black' });
    });

    it('returns red for "bug" type', () => {
      const result = themeStore.getState().resolveFieldColor('type', 'bug');
      expect(result).toEqual({ bg: 'red', fg: 'white' });
    });

    it('returns blue for "medium" priority', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('priority', 'medium');
      expect(result).toEqual({ bg: 'blue', fg: 'white' });
    });

    it('returns green for "resolved" status', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('status', 'Resolved');
      expect(result).toEqual({ bg: 'green', fg: 'white' });
    });

    it('returns red for "removed" status', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('status', 'Removed');
      expect(result).toEqual({ bg: 'red', fg: 'white' });
    });

    it('returns cyan for "design" status', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('status', 'Design');
      expect(result).toEqual({ bg: 'cyan', fg: 'black' });
    });

    it('returns a hash color for unmatched status', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('status', 'unknown-xyz');
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('bg');
      expect(result).toHaveProperty('fg');
    });
  });

  describe('label hashing', () => {
    it('returns a color for any label', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('label', 'frontend');
      expect(result).not.toBeNull();
    });

    it('is deterministic', () => {
      const a = themeStore.getState().resolveFieldColor('label', 'frontend');
      const b = themeStore.getState().resolveFieldColor('label', 'frontend');
      expect(a).toEqual(b);
    });

    it('is case-insensitive', () => {
      const a = themeStore.getState().resolveFieldColor('label', 'Frontend');
      const b = themeStore.getState().resolveFieldColor('label', 'frontend');
      expect(a).toEqual(b);
    });
  });

  describe('field value hashing (non-label)', () => {
    it('returns a color for any status value', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('status', 'SomeCustomStatus');
      expect(result).not.toBeNull();
    });

    it('returns a color for any type value', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('type', 'SomeCustomType');
      expect(result).not.toBeNull();
    });

    it('returns a color for any priority value', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('priority', 'SomeCustomPriority');
      expect(result).not.toBeNull();
    });

    it('is deterministic for statuses', () => {
      const a = themeStore
        .getState()
        .resolveFieldColor('status', 'CustomState');
      const b = themeStore
        .getState()
        .resolveFieldColor('status', 'CustomState');
      expect(a).toEqual(b);
    });
  });

  describe('user overrides', () => {
    it('override wins over keyword default', () => {
      themeStore.setState({
        colorOverrides: {
          status: { done: { bg: 'magenta', fg: 'black' } },
        },
      });
      const result = themeStore.getState().resolveFieldColor('status', 'done');
      expect(result).toEqual({ bg: 'magenta', fg: 'black' });
    });

    it('override wins over label hash', () => {
      themeStore.setState({
        colorOverrides: {
          label: { frontend: { bg: 'red', fg: 'white' } },
        },
      });
      const result = themeStore
        .getState()
        .resolveFieldColor('label', 'frontend');
      expect(result).toEqual({ bg: 'red', fg: 'white' });
    });
  });

  describe('high-contrast theme', () => {
    beforeEach(() => {
      themeStore.setState({ themeName: 'high-contrast', colorOverrides: {} });
    });

    it('uses bright variants', () => {
      const result = themeStore.getState().resolveFieldColor('status', 'done');
      expect(result).toEqual({ bg: 'greenBright', fg: 'white' });
    });
  });

  describe('loadColorOverrides', () => {
    it('builds overrides from DB mapping array', () => {
      themeStore.getState().loadColorOverrides([
        { fieldType: 'status', value: 'done', bg: 'magenta', fg: 'black' },
        { fieldType: 'label', value: 'ux', bg: 'red', fg: 'white' },
      ]);
      expect(themeStore.getState().resolveFieldColor('status', 'done')).toEqual(
        { bg: 'magenta', fg: 'black' },
      );
      expect(themeStore.getState().resolveFieldColor('label', 'ux')).toEqual({
        bg: 'red',
        fg: 'white',
      });
    });
  });
});

describe('autoFg', () => {
  it('returns black for light backgrounds', () => {
    expect(autoFg('yellow')).toBe('black');
    expect(autoFg('cyan')).toBe('black');
    expect(autoFg('white')).toBe('black');
    expect(autoFg('yellowBright')).toBe('black');
  });

  it('returns white for dark backgrounds', () => {
    expect(autoFg('red')).toBe('white');
    expect(autoFg('blue')).toBe('white');
    expect(autoFg('green')).toBe('white');
    expect(autoFg('magenta')).toBe('white');
  });
});

describe('selection theme colors', () => {
  it('default theme has selectionBg', () => {
    themeStore.setState({ themeName: 'default', colorOverrides: {} });
    expect(themeStore.getState().colors.selectionBg).toBe('cyanBright');
  });

  it('default theme has selectedMarkedBg', () => {
    themeStore.setState({ themeName: 'default', colorOverrides: {} });
    expect(themeStore.getState().colors.selectedMarkedBg).toBe('magentaBright');
  });

  it('high-contrast theme has selectionBg', () => {
    expect(themes['high-contrast']!.selectionBg).toBe('whiteBright');
  });
});

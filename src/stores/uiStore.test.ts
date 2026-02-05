import { describe, it, expect, beforeEach } from 'vitest';
import { uiStore, getOverlayTargetIds } from './uiStore.js';

describe('uiStore', () => {
  beforeEach(() => {
    uiStore.getState().reset();
  });

  it('starts with no active overlay', () => {
    expect(uiStore.getState().activeOverlay).toBeNull();
    expect(uiStore.getState().warning).toBe('');
  });

  it('opens an overlay', () => {
    uiStore.getState().openOverlay({ type: 'search' });
    expect(uiStore.getState().activeOverlay).toEqual({ type: 'search' });
  });

  it('opens an overlay with targetIds', () => {
    uiStore
      .getState()
      .openOverlay({ type: 'priority-picker', targetIds: ['1', '2'] });
    const overlay = uiStore.getState().activeOverlay;
    expect(overlay).toEqual({
      type: 'priority-picker',
      targetIds: ['1', '2'],
    });
  });

  it('replaces active overlay when opening another', () => {
    uiStore.getState().openOverlay({ type: 'bulk-menu' });
    uiStore.getState().openOverlay({ type: 'status-picker', targetIds: ['1'] });
    expect(uiStore.getState().activeOverlay).toEqual({
      type: 'status-picker',
      targetIds: ['1'],
    });
  });

  it('closes overlay', () => {
    uiStore.getState().openOverlay({ type: 'search' });
    uiStore.getState().closeOverlay();
    expect(uiStore.getState().activeOverlay).toBeNull();
  });

  it('sets warning', () => {
    uiStore.getState().setWarning('Something happened');
    expect(uiStore.getState().warning).toBe('Something happened');
  });

  it('clears warning', () => {
    uiStore.getState().setWarning('Something happened');
    uiStore.getState().clearWarning();
    expect(uiStore.getState().warning).toBe('');
  });

  it('reset clears everything', () => {
    uiStore.getState().openOverlay({ type: 'search' });
    uiStore.getState().setWarning('test');
    uiStore.getState().reset();
    expect(uiStore.getState().activeOverlay).toBeNull();
    expect(uiStore.getState().warning).toBe('');
  });

  it('getOverlayTargetIds returns targetIds when overlay has them', () => {
    uiStore
      .getState()
      .openOverlay({ type: 'priority-picker', targetIds: ['1', '2'] });
    expect(getOverlayTargetIds()).toEqual(['1', '2']);
  });

  it('getOverlayTargetIds returns empty array when overlay has no targetIds', () => {
    uiStore.getState().openOverlay({ type: 'search' });
    expect(getOverlayTargetIds()).toEqual([]);
  });

  it('getOverlayTargetIds returns empty array when no overlay', () => {
    expect(getOverlayTargetIds()).toEqual([]);
  });

  it('opens settings overlay with templateSlug', () => {
    uiStore.getState().openOverlay({
      type: 'delete-template-confirm',
      templateSlug: 'bug-report',
    });
    const overlay = uiStore.getState().activeOverlay;
    expect(overlay).toEqual({
      type: 'delete-template-confirm',
      templateSlug: 'bug-report',
    });
  });
});

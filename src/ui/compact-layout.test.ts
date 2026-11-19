import { describe, expect, it } from 'vitest';
import {
  MOBILE_LAYOUT_MAX_PX,
  defaultPanelCollapsed,
  isMobileLayoutWidth,
} from './mobile-layout.js';

describe('isMobileLayoutWidth', () => {
  it('treats the reported 390px phone viewport as mobile', () => {
    expect(isMobileLayoutWidth(390)).toBe(true);
  });

  it('includes the breakpoint width and excludes one pixel above it', () => {
    expect(isMobileLayoutWidth(MOBILE_LAYOUT_MAX_PX)).toBe(true);
    expect(isMobileLayoutWidth(MOBILE_LAYOUT_MAX_PX + 1)).toBe(false);
  });
});

describe('defaultPanelCollapsed', () => {
  it('defaults panels closed on mobile when the user has no stored choice', () => {
    expect(defaultPanelCollapsed(null, true)).toBe(true);
    expect(defaultPanelCollapsed(null, false)).toBe(false);
  });

  it('honours an explicit expand or collapse preference on any viewport', () => {
    expect(defaultPanelCollapsed('0', true)).toBe(false);
    expect(defaultPanelCollapsed('1', false)).toBe(true);
  });
});

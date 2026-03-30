import {
  resolveExitTab,
  deriveDiscoverOrigin,
  type DiscoverOrigin,
} from '../discoverNavigation';

/**
 * Tests for context-aware back navigation from the Discover view.
 *
 * Requirements:
 *   1. Open from Project  → Back → 'projects'
 *   2. Open from Package  → Back → 'messages'
 *   3. Open from Discovery → Back → null (no back action)
 *   4. Refresh / missing origin → safe fallback (null)
 *   5. No broken / unknown routes
 */

describe('resolveExitTab', () => {
  it('returns "projects" when origin is "project"', () => {
    expect(resolveExitTab('project')).toBe('projects');
  });

  it('returns "messages" when origin is "package"', () => {
    expect(resolveExitTab('package')).toBe('messages');
  });

  it('returns null when origin is "discovery" (no back action needed)', () => {
    expect(resolveExitTab('discovery')).toBeNull();
  });

  it('handles all valid DiscoverOrigin values without throwing', () => {
    const origins: DiscoverOrigin[] = ['discovery', 'project', 'package'];
    origins.forEach((origin) => {
      expect(() => resolveExitTab(origin)).not.toThrow();
    });
  });

  it('never returns an unknown tab value', () => {
    const validTabs = ['discover', 'projects', 'agencies', 'messages', 'calendar', 'team', null];
    const origins: DiscoverOrigin[] = ['discovery', 'project', 'package'];
    origins.forEach((origin) => {
      const result = resolveExitTab(origin);
      expect(validTabs).toContain(result);
    });
  });
});

describe('deriveDiscoverOrigin', () => {
  it('returns "package" when isPackageMode is true (takes precedence)', () => {
    expect(deriveDiscoverOrigin(false, true)).toBe('package');
    expect(deriveDiscoverOrigin(true, true)).toBe('package');
  });

  it('returns "project" when only isSharedMode is true', () => {
    expect(deriveDiscoverOrigin(true, false)).toBe('project');
  });

  it('returns "discovery" when neither mode is active (page refresh / direct URL)', () => {
    expect(deriveDiscoverOrigin(false, false)).toBe('discovery');
  });

  it('safe fallback: missing context always resolves to a non-breaking exit tab', () => {
    const origin = deriveDiscoverOrigin(false, false);
    const exitTab = resolveExitTab(origin);
    // null = no navigation override, which is the safe fallback behaviour
    expect(exitTab).toBeNull();
  });
});

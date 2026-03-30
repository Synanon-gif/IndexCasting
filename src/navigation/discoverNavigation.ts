/**
 * Discover-View Context Navigation
 *
 * Resolves which tab to return to when the user exits the Discover view,
 * depending on where they entered from (project, package, or plain discovery).
 *
 * Origin is implicitly encoded in existing ClientWebApp state:
 *   sharedProjectId !== null  →  origin = 'project'
 *   packageViewState !== null →  origin = 'package'
 *   neither                   →  origin = 'discovery'
 */

export type DiscoverOrigin = 'discovery' | 'project' | 'package';

export type ClientTopTab =
  | 'discover'
  | 'projects'
  | 'agencies'
  | 'messages'
  | 'calendar'
  | 'team';

/**
 * Returns the tab to navigate to when the user clicks "Back" from Discovery.
 * Returns `null` for plain Discovery (no contextual back action needed).
 */
export function resolveExitTab(origin: DiscoverOrigin): ClientTopTab | null {
  if (origin === 'project') return 'projects';
  if (origin === 'package') return 'messages';
  return null;
}

/**
 * Derives the DiscoverOrigin from the current ClientWebApp state flags.
 * Useful as a safe fallback: if for any reason the state is inconsistent,
 * defaults to 'discovery' so no broken navigation occurs.
 */
export function deriveDiscoverOrigin(
  isSharedMode: boolean,
  isPackageMode: boolean,
): DiscoverOrigin {
  if (isPackageMode) return 'package';
  if (isSharedMode) return 'project';
  return 'discovery';
}

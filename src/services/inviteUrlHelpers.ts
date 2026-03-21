/**
 * Reine URL-Hilfen für Einladungslinks (unit-testbar ohne React Native / Window).
 * Entspricht: new URL(origin + (pathname || '/')) + searchParams.set('invite', token)
 */
export function buildInviteAbsoluteUrl(
  origin: string,
  pathname: string | undefined,
  token: string
): string {
  const suffix = pathname && pathname.length > 0 ? pathname : '/';
  const u = new URL(origin + suffix);
  u.searchParams.set('invite', token);
  return u.toString();
}

export function buildInviteDeepLinkPath(token: string): string {
  return `/?invite=${encodeURIComponent(token)}`;
}

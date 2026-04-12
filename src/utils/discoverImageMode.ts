/** Desktop discover/package hero: show full image without crop; mobile keeps cover. */
export function getHeroResizeMode(isMobileWidth: boolean): 'cover' | 'contain' {
  return isMobileWidth ? 'cover' : 'contain';
}

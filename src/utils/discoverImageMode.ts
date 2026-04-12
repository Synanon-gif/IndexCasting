/** All discover/package/project hero images: show full image without crop on every device. */
export function getHeroResizeMode(_isMobileWidth: boolean): 'cover' | 'contain' {
  return 'contain';
}

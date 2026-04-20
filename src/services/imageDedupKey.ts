/**
 * Provider-neutraler Bild-Dedup-Key.
 *
 * Ursprünglich Teil von `mediaslidePackageParser`, herausgezogen damit der
 * provider-neutrale `packageImporter` nicht direkt am MediaSlide-Parser-Modul
 * hängt (saubere Schichtung für Netwalk).
 *
 * Erkennt MediaSlide-GCS-URLs (`/pictures/{modelId}/{categoryId}/{md5}`) und
 * baut daraus einen kompakten Key. Für andere URL-Formen wird der Pfad ohne
 * Querystring zurückgegeben — schwächerer, aber stabiler Fallback.
 */
export function imageDedupKey(url: string): string {
  if (typeof url !== 'string' || url.length === 0) return '';
  const m = url.match(/\/pictures\/(\d+)\/(\d+)\/(?:profile|large|thumb)-\d+-([0-9a-f]{32})\.jpg/i);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return url.split('?')[0];
}

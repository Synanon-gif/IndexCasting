/**
 * Provider Registry — zentraler Lookup für alle PackageProvider.
 *
 * UI und Tests gehen NIEMALS direkt gegen einen konkreten Provider, sondern
 * fragen `getProviderForUrl(url)`. So bleibt die Erweiterung um Netwalk (oder
 * spätere Provider) eine reine Registry-Änderung — kein UI-Refactor nötig.
 *
 * KEIN State außer dem (per Test überschreibbaren) Provider-Array.
 */

import type { PackageProvider } from './packageImportTypes';
import { createMediaslidePackageProvider } from './mediaslidePackageProvider';
import { createNetwalkPackageProvider } from './netwalkPackageProvider';

const DEFAULT_PROVIDERS: PackageProvider[] = [
  createMediaslidePackageProvider(),
  createNetwalkPackageProvider(),
];

let providers: PackageProvider[] = DEFAULT_PROVIDERS;

/**
 * Liefert den ersten Provider, dessen `detect(url)` true zurückgibt.
 * Reihenfolge entspricht Registrierungsreihenfolge — spezifischere Provider
 * sollten zuerst stehen (MediaSlide vor Netwalk, weil MediaSlide eine sehr
 * eindeutige Pfad-Struktur hat).
 */
export function getProviderForUrl(url: string): PackageProvider | null {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return null;
  for (const p of providers) {
    try {
      if (p.detect({ url: trimmed })) return p;
    } catch {
      // Detect darf NIE werfen — falls doch, ignorieren wir den Provider und
      // probieren den nächsten. So zerstört ein einzelner kaputter Provider
      // nicht die ganze Registry.
    }
  }
  return null;
}

export function listProviders(): PackageProvider[] {
  return [...providers];
}

export function listProviderIds(): string[] {
  return providers.map((p) => p.id);
}

/**
 * Test-Hook: erlaubt es, die Registry für Unit-Tests zu überschreiben.
 * NIEMALS in Produktionscode aufrufen.
 */
export function setProvidersForTest(next: PackageProvider[]): void {
  providers = [...next];
}

export function resetProvidersForTest(): void {
  providers = DEFAULT_PROVIDERS;
}

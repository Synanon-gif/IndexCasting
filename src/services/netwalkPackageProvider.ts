/**
 * Netwalk Package Provider — STUB.
 *
 * Phase 1 implementiert nur `detect()` (URL-Heuristik) und einen `analyze()`,
 * der einen klar erkennbaren Fehler-Code wirft. Der echte Parser folgt, sobald
 * uns echte Netwalk-Sample-Pakete vorliegen (siehe `docs/MEDIASLIDE_NETWALK_SYNC.md`).
 *
 * Vorteil dieses Stubs: Die UI kann eine Netwalk-URL bereits erkennen und mit
 * einer sauberen Fehlermeldung antworten, statt mit einem generischen
 * "package_url_invalid". Außerdem ist der Provider-Slot in `providerRegistry.ts`
 * besetzt — kein UI/Importer-Refactor nötig, sobald der Parser kommt.
 */

import type { AnalyzeProgress, PackageProvider, ProviderImportPayload } from './packageImportTypes';

const PROVIDER_ID = 'netwalk' as const;

const NETWALK_HOST_PATTERNS: RegExp[] = [
  /(^|\.)netwalk\.eu$/i,
  /(^|\.)netwalk\.app$/i,
  /(^|\.)netwalkapp\.com$/i,
];

export type NetwalkProviderOptions = {
  /** Test-Hook: zusätzliche Host-Patterns für Detection. */
  extraHostPatterns?: RegExp[];
};

export function createNetwalkPackageProvider(opts: NetwalkProviderOptions = {}): PackageProvider {
  const hostPatterns = [...NETWALK_HOST_PATTERNS, ...(opts.extraHostPatterns ?? [])];

  function detect(input: { url: string }): boolean {
    try {
      const u = new URL(input.url);
      return hostPatterns.some((re) => re.test(u.hostname));
    } catch {
      return false;
    }
  }

  async function analyze(_input: {
    url: string;
    signal?: AbortSignal;
    onProgress?: (s: AnalyzeProgress) => void;
  }): Promise<ProviderImportPayload[]> {
    void _input;
    throw new Error('netwalk_provider_not_implemented');
  }

  return { id: PROVIDER_ID, detect, analyze };
}

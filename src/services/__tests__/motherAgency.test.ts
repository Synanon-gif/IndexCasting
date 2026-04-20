/**
 * Mother-Agency invariants — informational free-text only.
 *
 * Hard product rule (see `.cursor/rules/mother-agency.mdc`):
 *  - The two columns `mother_agency_name` and `mother_agency_contact` are
 *    purely informational. They MUST NOT influence import / sync / matching /
 *    ownership / RLS / casting.
 *  - They are written exclusively through `agency_update_model_full` (Agency
 *    Owner / Booker). Package importers MUST NOT auto-fill them.
 *
 * These tests act as a regression fence so a future refactor cannot silently
 * smuggle the mother-agency fields into the import payload, the sync services,
 * or the provider-import contract.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../territoriesSupabase', () => ({
  upsertTerritoriesForModelCountryAgencyPairs: jest.fn().mockResolvedValue([]),
}));

import { previewToImportPayload, toPreviewModels } from '../packageImporter';
import type { ProviderImportPayload } from '../packageImportTypes';
import { buildEditState, type ModelEditState } from '../../utils/modelEditState';
import type { ImportModelPayload } from '../modelsImportSupabase';

function payload(overrides: Partial<ProviderImportPayload> = {}): ProviderImportPayload {
  return {
    externalProvider: 'mediaslide',
    externalId: 'MS-1',
    name: 'Test',
    measurements: { height: 180 },
    portfolio_image_urls: ['https://x/y/pictures/1/1/large-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'],
    polaroid_image_urls: [],
    ...overrides,
  };
}

describe('Mother Agency — invariant: never set by package importer', () => {
  it('previewToImportPayload does NOT include mother_agency_name / contact', () => {
    const previews = toPreviewModels([payload()]);
    const p: ImportModelPayload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'a-1',
      options: {},
    });
    expect((p as Record<string, unknown>).mother_agency_name).toBeUndefined();
    expect((p as Record<string, unknown>).mother_agency_contact).toBeUndefined();
  });

  it('mother_agency_* in raw provider payload is silently ignored (not propagated)', () => {
    // Even if a hostile / future provider sneaks the fields into the raw payload,
    // the importer must not pass them through. The ProviderImportPayload type
    // does not declare them, so this is also a TypeScript-level guarantee.
    const hostile = {
      ...payload(),
      mother_agency_name: 'Injected Mother',
      mother_agency_contact: 'evil@example.com',
    } as unknown as ProviderImportPayload;
    const previews = toPreviewModels([hostile]);
    const p: ImportModelPayload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'a-1',
      options: {},
    });
    expect((p as Record<string, unknown>).mother_agency_name).toBeUndefined();
    expect((p as Record<string, unknown>).mother_agency_contact).toBeUndefined();
    // And the preview itself does not surface them either.
    expect((previews[0] as Record<string, unknown>).mother_agency_name).toBeUndefined();
    expect((previews[0] as Record<string, unknown>).mother_agency_contact).toBeUndefined();
  });
});

describe('Mother Agency — buildEditState defaults are empty strings', () => {
  it('defaults to empty strings when source model has no mother_agency_* fields', () => {
    const s: ModelEditState = buildEditState({ name: 'A' });
    expect(s.mother_agency_name).toBe('');
    expect(s.mother_agency_contact).toBe('');
  });

  it('passes through stored values without transformation', () => {
    const s: ModelEditState = buildEditState({
      name: 'A',
      mother_agency_name: 'New Madison Paris',
      mother_agency_contact: 'booker@newmadison.example',
    });
    expect(s.mother_agency_name).toBe('New Madison Paris');
    expect(s.mother_agency_contact).toBe('booker@newmadison.example');
  });

  it('null sources collapse to empty strings (no "null" leak into the input)', () => {
    const s: ModelEditState = buildEditState({
      name: 'A',
      mother_agency_name: null,
      mother_agency_contact: null,
    });
    expect(s.mother_agency_name).toBe('');
    expect(s.mother_agency_contact).toBe('');
  });
});

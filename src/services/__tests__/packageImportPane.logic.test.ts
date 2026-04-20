/**
 * UI logic tests for PackageImportPane — does NOT render React.
 *
 * Instead, we model the Pane's state machine as a pure reducer and test:
 *  - all phase transitions (idle → analyzing → previewing → committing → done)
 *  - drift_blocked + drift_override_confirm flows
 *  - that the override flow re-runs analyze with allowDriftBypass=true
 *  - that the importer's safety nets still fire even in override mode
 *
 * This way we lock the contract between provider + UI without paying the cost
 * of full React Native testing infrastructure.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../territoriesSupabase', () => ({
  upsertTerritoriesForModelCountryAgencyPairs: jest.fn().mockResolvedValue([]),
}));

import {
  isParserDriftError,
  ParserDriftError,
  type DriftResult,
  type PackageProvider,
  type PreviewModel,
  type ProviderImportPayload,
} from '../packageImportTypes';
import { toPreviewModels } from '../packageImporter';

type Phase =
  | 'idle'
  | 'analyzing'
  | 'previewing'
  | 'committing'
  | 'done'
  | 'drift_blocked'
  | 'drift_override_confirm';

type State = {
  phase: Phase;
  drift: DriftResult | null;
  previews: PreviewModel[];
  error: string | null;
  overrideText: string;
};

type Event =
  | { type: 'analyze_start' }
  | { type: 'analyze_drift_warning'; drift: DriftResult }
  | { type: 'analyze_drift_block'; drift: DriftResult }
  | { type: 'analyze_success'; previews: PreviewModel[] }
  | { type: 'analyze_error'; message: string }
  | { type: 'override_request' }
  | { type: 'override_cancel' }
  | { type: 'override_text_change'; text: string }
  | { type: 'override_confirm' }
  | { type: 'commit_start' }
  | { type: 'commit_done' }
  | { type: 'reset' };

function reduce(state: State, event: Event): State {
  switch (event.type) {
    case 'analyze_start':
      return {
        ...state,
        phase: 'analyzing',
        error: null,
        // drift bleibt sichtbar wenn override
      };
    case 'analyze_drift_warning':
      return { ...state, drift: event.drift };
    case 'analyze_drift_block':
      return { ...state, phase: 'drift_blocked', drift: event.drift };
    case 'analyze_success':
      return { ...state, phase: 'previewing', previews: event.previews };
    case 'analyze_error':
      return { ...state, phase: 'idle', error: event.message };
    case 'override_request':
      return { ...state, phase: 'drift_override_confirm', overrideText: '' };
    case 'override_cancel':
      return { ...state, phase: 'drift_blocked', overrideText: '' };
    case 'override_text_change':
      return { ...state, overrideText: event.text };
    case 'override_confirm':
      if (state.overrideText.trim().toUpperCase() !== 'OVERRIDE') return state;
      return { ...state, phase: 'analyzing', overrideText: '' };
    case 'commit_start':
      return { ...state, phase: 'committing' };
    case 'commit_done':
      return { ...state, phase: 'done' };
    case 'reset':
      return {
        phase: 'idle',
        drift: null,
        previews: [],
        error: null,
        overrideText: '',
      };
  }
}

const initial: State = {
  phase: 'idle',
  drift: null,
  previews: [],
  error: null,
  overrideText: '',
};

function makeDrift(overrides: Partial<DriftResult> = {}): DriftResult {
  return {
    severity: 'hard_block',
    parserVersion: 'mediaslide-2026-04',
    providerId: 'mediaslide',
    maskedUrl: 'https://x.mediaslide.com/package/…',
    anchorCoverage: 0.2,
    missingAnchors: ['class="packageModel"'],
    extractionRatio: 0.1,
    bookOkRatio: 1,
    reasonCodes: ['parser_anchor_coverage_low'],
    cardsDetected: 0,
    cardsExtracted: 0,
    ...overrides,
  };
}

describe('PackageImportPane reducer — happy path', () => {
  it('transitions idle → analyzing → previewing → committing → done', () => {
    let s = initial;
    s = reduce(s, { type: 'analyze_start' });
    expect(s.phase).toBe('analyzing');
    s = reduce(s, { type: 'analyze_success', previews: [] });
    expect(s.phase).toBe('previewing');
    s = reduce(s, { type: 'commit_start' });
    expect(s.phase).toBe('committing');
    s = reduce(s, { type: 'commit_done' });
    expect(s.phase).toBe('done');
  });

  it('reset returns to clean idle state regardless of phase', () => {
    let s: State = { ...initial, phase: 'committing', drift: makeDrift() };
    s = reduce(s, { type: 'reset' });
    expect(s).toEqual(initial);
  });
});

describe('PackageImportPane reducer — drift_blocked flow', () => {
  it('moves to drift_blocked on hard drift, preserves drift payload', () => {
    let s = initial;
    s = reduce(s, { type: 'analyze_start' });
    const d = makeDrift();
    s = reduce(s, { type: 'analyze_drift_block', drift: d });
    expect(s.phase).toBe('drift_blocked');
    expect(s.drift).toEqual(d);
  });

  it('soft drift only attaches drift, stays in current phase', () => {
    let s = reduce(initial, { type: 'analyze_start' });
    s = reduce(s, { type: 'analyze_drift_warning', drift: makeDrift({ severity: 'soft_warn' }) });
    expect(s.phase).toBe('analyzing');
    expect(s.drift?.severity).toBe('soft_warn');
  });

  it('override request opens confirm modal with empty text', () => {
    let s: State = { ...initial, phase: 'drift_blocked', drift: makeDrift(), overrideText: 'old' };
    s = reduce(s, { type: 'override_request' });
    expect(s.phase).toBe('drift_override_confirm');
    expect(s.overrideText).toBe('');
  });

  it('override cancel returns to drift_blocked', () => {
    let s: State = { ...initial, phase: 'drift_override_confirm', drift: makeDrift() };
    s = reduce(s, { type: 'override_cancel' });
    expect(s.phase).toBe('drift_blocked');
  });

  it('override confirm requires literal "OVERRIDE" text, otherwise no-op', () => {
    let s: State = { ...initial, phase: 'drift_override_confirm', drift: makeDrift() };
    s = reduce(s, { type: 'override_text_change', text: 'override' });
    s = reduce(s, { type: 'override_confirm' });
    // lowercase is normalised → ok
    expect(s.phase).toBe('analyzing');
  });

  it('override confirm with wrong text is a no-op', () => {
    let s: State = {
      ...initial,
      phase: 'drift_override_confirm',
      drift: makeDrift(),
      overrideText: 'yes',
    };
    s = reduce(s, { type: 'override_confirm' });
    expect(s.phase).toBe('drift_override_confirm');
  });

  it('drift remains visible after successful override → previewing', () => {
    let s: State = {
      ...initial,
      phase: 'drift_override_confirm',
      drift: makeDrift(),
      overrideText: 'OVERRIDE',
    };
    s = reduce(s, { type: 'override_confirm' });
    expect(s.phase).toBe('analyzing');
    expect(s.drift).not.toBeNull();
    s = reduce(s, { type: 'analyze_success', previews: [] });
    expect(s.phase).toBe('previewing');
    expect(s.drift).not.toBeNull();
  });
});

describe('PackageImportPane integration — provider drift wiring', () => {
  function makePayload(overrides: Partial<ProviderImportPayload> = {}): ProviderImportPayload {
    return {
      externalProvider: 'mediaslide',
      externalId: '1',
      name: 'M',
      coverImageUrl: null,
      measurements: { height: 180 },
      portfolio_image_urls: [
        'https://x/y/pictures/1/1/large-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
      ],
      polaroid_image_urls: [],
      ...overrides,
    };
  }

  function fakeProvider(opts: {
    throwDrift?: DriftResult | null;
    softDrift?: DriftResult | null;
    payloads: ProviderImportPayload[];
  }): PackageProvider {
    return {
      id: 'mediaslide',
      detect: () => true,
      analyze: async (input) => {
        if (opts.throwDrift && !input.allowDriftBypass) {
          throw new ParserDriftError(opts.throwDrift);
        }
        if (opts.softDrift) input.onDrift?.(opts.softDrift);
        return opts.payloads;
      },
    };
  }

  it('hard drift surfaces as ParserDriftError → UI moves to drift_blocked', async () => {
    const provider = fakeProvider({ throwDrift: makeDrift(), payloads: [] });
    let caught: unknown;
    try {
      await provider.analyze({ url: 'https://x.mediaslide.com/p' });
    } catch (e) {
      caught = e;
    }
    expect(isParserDriftError(caught)).toBe(true);
    if (isParserDriftError(caught)) {
      expect(caught.drift.severity).toBe('hard_block');
    }
  });

  it('override re-run: same provider, allowDriftBypass=true → succeeds, payloads returned', async () => {
    const drift = makeDrift();
    const provider = fakeProvider({
      throwDrift: drift,
      payloads: [makePayload(), makePayload({ externalId: '2' })],
    });

    // First call (no bypass) throws
    await expect(provider.analyze({ url: 'https://x.mediaslide.com/p' })).rejects.toThrow(
      'parser_drift_detected',
    );

    // Second call WITH bypass returns payloads — UI then reduces normally
    const payloads = await provider.analyze({
      url: 'https://x.mediaslide.com/p',
      allowDriftBypass: true,
    });
    expect(payloads).toHaveLength(2);

    const previews = toPreviewModels(payloads);
    expect(previews.every((p) => p.status === 'ready')).toBe(true);
  });

  it('override mode still respects forceSkipReason → DB-safe', async () => {
    const provider = fakeProvider({
      throwDrift: makeDrift(),
      payloads: [
        makePayload({
          forceSkipReason: 'book_fetch_failed',
          portfolio_image_urls: [],
          polaroid_image_urls: [],
        }),
      ],
    });
    const payloads = await provider.analyze({
      url: 'https://x.mediaslide.com/p',
      allowDriftBypass: true,
    });
    const previews = toPreviewModels(payloads);
    expect(previews[0].status).toBe('skipped');
    expect(previews[0].skipReason).toBe('book_fetch_failed');
  });

  it('soft drift fires onDrift callback without throwing', async () => {
    const onDrift = jest.fn();
    const soft = makeDrift({ severity: 'soft_warn', anchorCoverage: 0.85 });
    const provider = fakeProvider({ softDrift: soft, payloads: [makePayload()] });
    const result = await provider.analyze({ url: 'https://x.mediaslide.com/p', onDrift });
    expect(result).toHaveLength(1);
    expect(onDrift).toHaveBeenCalledWith(soft);
  });
});

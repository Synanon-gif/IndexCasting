const mockInvoke = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

import { askAiAssistant, isAiAssistantContextFresh } from '../aiAssistantSupabase';

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('askAiAssistant', () => {
  it('invokes the ai-assistant Edge Function with trimmed input and role', async () => {
    mockInvoke.mockResolvedValue({
      data: { ok: true, answer: 'Use Projects to organize selections.' },
      error: null,
    });

    const result = await askAiAssistant({
      message: '  How do I create a project?  ',
      viewerRole: 'client',
      history: [{ role: 'assistant', content: 'Hi' }],
    });

    expect(result).toEqual({
      ok: true,
      answer: 'Use Projects to organize selections.',
      context: undefined,
    });
    expect(mockInvoke).toHaveBeenCalledWith('ai-assistant', {
      body: {
        message: 'How do I create a project?',
        viewerRole: 'client',
        history: [{ role: 'assistant', content: 'Hi' }],
        context: null,
      },
    });
  });

  it('fails closed on empty input without invoking the function', async () => {
    const result = await askAiAssistant({ message: '   ', viewerRole: 'agency' });

    expect(result).toEqual({ ok: false, error: 'empty_message' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('returns a safe error when invoke fails', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'network' } });

    const result = await askAiAssistant({ message: 'How do options work?', viewerRole: 'agency' });

    expect(result).toEqual({ ok: false, error: 'assistant_unavailable' });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns a safe error when the function returns ok:false', async () => {
    mockInvoke.mockResolvedValue({
      data: { ok: false, error: 'message_too_long' },
      error: null,
    });

    const result = await askAiAssistant({ message: 'Help', viewerRole: 'client' });

    expect(result).toEqual({ ok: false, error: 'message_too_long' });
  });

  it('preserves safe assistant context for follow-up routing', async () => {
    const context = {
      last_calendar_item: {
        date: '2026-04-28',
        start_time: '10:00',
        end_time: '14:00',
        kind: 'job',
        title: 'Job',
        model_name: 'Rémi Lovisolo',
        counterparty_name: 'Acme Client',
        note: 'Visible shoot description',
      },
      last_calendar_item_source: 'single_resolved_item' as const,
      last_intent: 'calendar_item_details',
      context_created_at: new Date(Date.now()).toISOString(),
      context_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    mockInvoke.mockResolvedValue({
      data: { ok: true, answer: 'The visible counterparty is Acme Client.', context },
      error: null,
    });

    const result = await askAiAssistant({
      message: 'Who was the client?',
      viewerRole: 'agency',
      context,
    });

    expect(result).toEqual({
      ok: true,
      answer: 'The visible counterparty is Acme Client.',
      context,
    });
    expect(mockInvoke).toHaveBeenCalledWith('ai-assistant', {
      body: {
        message: 'Who was the client?',
        viewerRole: 'agency',
        history: [],
        context,
      },
    });
  });

  it('drops stale assistant context before invoking the function', async () => {
    const now = Date.now();
    const staleContext = {
      last_calendar_item: {
        date: '2026-04-28',
        start_time: '10:00',
        end_time: '14:00',
        kind: 'job',
        title: 'Job',
        model_name: 'Rémi Lovisolo',
        counterparty_name: 'Acme Client',
      },
      last_calendar_item_source: 'single_resolved_item' as const,
      last_intent: 'calendar_item_details',
      context_created_at: new Date(now - 20 * 60 * 1000).toISOString(),
      context_expires_at: new Date(now - 10 * 60 * 1000).toISOString(),
    };
    mockInvoke.mockResolvedValue({
      data: { ok: true, answer: 'Which calendar item do you mean?' },
      error: null,
    });

    expect(isAiAssistantContextFresh(staleContext, now)).toBe(false);
    await askAiAssistant({
      message: 'Who was the client?',
      viewerRole: 'agency',
      context: staleContext,
    });

    expect(mockInvoke).toHaveBeenCalledWith('ai-assistant', {
      body: {
        message: 'Who was the client?',
        viewerRole: 'agency',
        history: [],
        context: null,
      },
    });
  });
});

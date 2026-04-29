const mockInvoke = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

import { askAiAssistant } from '../aiAssistantSupabase';

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

    expect(result).toEqual({ ok: true, answer: 'Use Projects to organize selections.' });
    expect(mockInvoke).toHaveBeenCalledWith('ai-assistant', {
      body: {
        message: 'How do I create a project?',
        viewerRole: 'client',
        history: [{ role: 'assistant', content: 'Hi' }],
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
    const context = { calendarFacts: { intent: 'calendar_summary', items: [] } };
    mockInvoke.mockResolvedValue({
      data: { ok: true, answer: 'No visible calendar items.', context },
      error: null,
    });

    const result = await askAiAssistant({
      message: 'What is on my calendar?',
      viewerRole: 'agency',
    });

    expect(result).toEqual({ ok: true, answer: 'No visible calendar items.', context });
  });
});

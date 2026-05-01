/**
 * Role-specific setup / product guidance (deterministic help_static + classifier).
 */
import { expect } from '@jest/globals';
import { readFileSync } from 'fs';
import * as path from 'path';
import {
  classifyAssistantIntent,
  resolveModelFactsExecutionResult,
  buildModelVisibleProfileFacts,
  type ViewerRole,
} from '../../../supabase/functions/ai-assistant/phase2';
import { tryDeterministicSetupResponse } from '../../../supabase/functions/ai-assistant/setupGuide';
import { getAiAssistantQuickPrompts } from '../../components/help/aiAssistantSetupGuide';

const BASE_DATE = new Date('2026-04-29T12:00:00.000Z');

function det(message: string, role: ViewerRole) {
  return tryDeterministicSetupResponse(message, role);
}

describe('AI setup guidance — Agency deterministic copy', () => {
  it('1 Help me set up my agency returns Agency checklist', () => {
    const r = det('Help me set up my agency', 'agency');
    expect(r).not.toBeNull();
    expect(r?.answer).toMatch(/Agency setup/i);
    expect(r?.answer).toMatch(/billing profile/i);
    expect(r?.answer).toMatch(/My Models/);
  });

  it('2 What should I do first returns Agency-prioritized setup steps', () => {
    const r = det('What should I do first?', 'agency');
    expect(r?.answer).toMatch(/Billing/);
    expect(r?.answer).toMatch(/My Models|Import package/);
  });

  it('3 Explain My Models uses Agency terminology', () => {
    const r = det('Explain My Models', 'agency');
    expect(r?.answer).toMatch(/\*\*My Models\*\*/);
    expect(r?.answer).toMatch(/Add model manually/);
  });

  it('4 What is Add Model Manually explains correctly', () => {
    const r = det('What is Add Model Manually?', 'agency');
    expect(r?.answer).toMatch(/Add model manually/i);
    expect(r?.answer).toMatch(/My Models/);
  });

  it('5 What is Import Package explains Mediaslide/Netwalk', () => {
    const r = det('What is Import Package?', 'agency');
    expect(r?.answer).toMatch(/Mediaslide|Netwalk/);
  });

  it('6 What does Assign Territories mean explains safely', () => {
    const r = det('What does Assign Territories mean?', 'agency');
    expect(r?.answer).toMatch(/territor/i);
    expect(r?.answer).toMatch(/cannot change|cannot change territory/i);
  });

  it('7 Where do I create an option says Calendar', () => {
    const r = det('Where do I create an option?', 'agency');
    expect(r?.answer).toMatch(/\*\*Calendar\*\*/);
    expect(r?.answer).toMatch(/Add Option/);
  });

  it('8 Explain Billing mentions invoice overview, manual invoices, profiles', () => {
    const r = det('Explain Billing', 'agency');
    expect(r?.answer).toMatch(/invoice overview/i);
    expect(r?.answer).toMatch(/manual invoice/i);
    expect(r?.answer).toMatch(/billing profile/i);
  });

  it('9 What does Paid/Open/Problem mean says internal tracking only', () => {
    const r = det('What does Open Paid Problem mean for invoice tracking?', 'agency');
    expect(r?.answer).toMatch(/internal/i);
    expect(r?.answer).toMatch(/Open|Paid|Problem/);
  });

  it('10 Agency answer must not include Client-only nav labels as instructions', () => {
    const r = det('Help me set up my agency', 'agency');
    expect(r?.answer).not.toMatch(/\*\*Discover\*\*/);
    expect(r?.answer).not.toMatch(/\*\*My Projects\*\*/);
  });
});

describe('AI setup guidance — Client deterministic copy', () => {
  it('11 Help me set up my client workspace returns Client checklist', () => {
    const r = det('Help me set up my client workspace', 'client');
    expect(r?.answer).toMatch(/Client setup/i);
    expect(r?.answer).toMatch(/My Projects/);
  });

  it('12 What should I do first returns Client-prioritized steps', () => {
    const r = det('What should I do first?', 'client');
    expect(r?.answer).toMatch(/Profile|My Projects/);
    expect(r?.answer).toMatch(/Calendar/);
  });

  it('13 Explain My Projects uses Client terminology', () => {
    const r = det('Explain My Projects', 'client');
    expect(r?.answer).toMatch(/\*\*My Projects\*\*/);
    expect(r?.answer).not.toMatch(/\*\*My Models\*\*/);
  });

  it('14 Explain Discover only for Client (conceptually)', () => {
    const r = det('Explain Discover', 'client');
    expect(r?.answer).toMatch(/Discover/);
    expect(r?.answer).toMatch(/visibility/i);
  });

  it('15 Where do I review bookings says Calendar', () => {
    const r = det('Where do I review bookings?', 'client');
    expect(r?.answer).toMatch(/\*\*Calendar\*\*/);
  });

  it('16 Explain Billing client-specific, no Agency model billing', () => {
    const r = det('Explain Billing', 'client');
    expect(r?.answer).toMatch(/Client/);
    expect(r?.answer).toMatch(/not.*agency model roster/i);
  });

  it('17 Client checklist answer must not include Agency-only nav as instructions', () => {
    const r = det('Help me set up my client workspace', 'client');
    expect(r?.answer).not.toMatch(/\*\*Recruiting\*\*/);
    expect(r?.answer).not.toMatch(/\*\*My Models\*\*/);
  });
});

describe('AI setup guidance — Security / role firewall', () => {
  it('18 Client asks How do I add models explains unavailable / agency feature', () => {
    const r = det('How do I add models?', 'client');
    expect(r?.answer).toMatch(/Agency|agency workspace/i);
    expect(classifyAssistantIntent('How do I add models?', 'client', BASE_DATE).intent).toBe(
      'help_static',
    );
  });

  it('19 Agency asks Discover question explains not in Agency workspace', () => {
    const r = det('What is Discover?', 'agency');
    expect(r?.answer).toMatch(/Client/);
    expect(r?.answer).not.toMatch(/open \*\*Discover\*\* from your agency/i);
  });

  it('20 No hidden billing amounts in deterministic answers', () => {
    const samples = [
      det('Explain Billing', 'agency')?.answer ?? '',
      det('What does Open Paid Problem mean for invoice status?', 'agency')?.answer ?? '',
    ].join('\n');
    expect(samples).not.toMatch(/€|\$|£|\d{3,}\.\d{2}/);
  });

  it('21 No team invite action claims', () => {
    const r = det('How do I onboard my team?', 'agency');
    expect(r?.answer.toLowerCase()).not.toMatch(/\bi (have |'ve )invited\b/);
    expect(r?.answer).toMatch(/cannot.*invit/i);
  });

  it('22 No write claims', () => {
    const r = det('Where do I create an option?', 'agency');
    expect(r?.answer.toLowerCase()).not.toMatch(/\bi (have |'ve )created\b/);
  });

  it('23 No service_role / DB / RLS in answers', () => {
    const r = det('Help me set up my agency', 'agency')?.answer ?? '';
    expect(r.toLowerCase()).not.toMatch(/service_role|\brls\b|database/i);
  });

  it('24 Does not claim access to other organizations live data', () => {
    const r = det('Help me set up my agency', 'agency')?.answer ?? '';
    expect(r.toLowerCase()).not.toMatch(
      /\b(i can|we can|i'll)\s+(show|list|export)\b.*\b(other|another)\s+(org|agency|client)/i,
    );
  });

  it('25 Setup questions route to help_static (not unknown_live_data): agency setup', () => {
    expect(classifyAssistantIntent('Help me set up my agency', 'agency', BASE_DATE).intent).toBe(
      'help_static',
    );
  });
});

describe('AI setup guidance — Quick prompts', () => {
  it('exports Agency and Client quick prompts', () => {
    expect(getAiAssistantQuickPrompts('agency')).toEqual([
      'How does an option work?',
      'How does price negotiation work?',
      'How should I communicate with models?',
      'Explain Billing',
      'Help me set up my agency',
    ]);
    expect(getAiAssistantQuickPrompts('client')).toEqual([
      'How do I request an option?',
      'How does price negotiation work?',
      'How do I communicate with agencies?',
      'Explain My Projects',
      'Help me set up my workspace',
    ]);
    expect(getAiAssistantQuickPrompts('model').length).toBe(0);
  });
});

describe('AI setup guidance — Expanded workflow education (Agency)', () => {
  it('manual option explains Calendar Add Option + assistant limits', () => {
    const r = det('How does a manual option work?', 'agency');
    expect(r?.answer).toMatch(/Add Option/i);
    expect(r?.answer).toMatch(/Calendar/i);
    expect(r?.answer).toMatch(/visible calendar conflicts/i);
  });

  it('casting explains Add Casting', () => {
    const r = det('How does casting work?', 'agency');
    expect(r?.answer).toMatch(/Add Casting/i);
    expect(r?.answer).toMatch(/Calendar/i);
  });

  it('difference option casting job gives conceptual distinction', () => {
    const r = det('What is the difference between option, casting and job?', 'agency');
    expect(r?.answer).toMatch(/\*\*Option:\*\*/);
    expect(r?.answer).toMatch(/\*\*Job:\*\*/);
    expect(
      classifyAssistantIntent(
        'What is the difference between option, casting and job?',
        'agency',
        BASE_DATE,
      ).intent,
    ).toBe('help_static');
  });

  it('communicate with models uses Messages guidance', () => {
    const r = det('How should I communicate with models?', 'agency');
    expect(r?.answer).toMatch(/\*\*Messages\*\*/);
    expect(r?.answer).not.toMatch(/\*\*Discover\*\*/);
  });

  it('communicate with clients uses Clients/Messages', () => {
    const r = det('How do I communicate with clients?', 'agency');
    expect(r?.answer).toMatch(/\*\*Clients\*\*/);
    expect(r?.answer).toMatch(/\*\*Messages\*\*/);
  });

  it('price negotiation explains workflow without amounts', () => {
    const r = det('How does price negotiation work?', 'agency');
    expect(r?.answer).toMatch(/pending/i);
    expect(r?.answer).toMatch(/thread/i);
    expect(r?.answer).not.toMatch(/\$\d|[€£]\s*\d/);
  });

  it('counteroffers conceptual Agency', () => {
    const r = det('How do counteroffers work?', 'agency');
    expect(r?.answer).toMatch(/counter/i);
    expect(r?.answer).not.toMatch(/\$\d/);
  });

  it('manual invoicing points to Billing manual invoices', () => {
    const r = det('How does manual invoicing work?', 'agency');
    expect(r?.answer).toMatch(/Manual invoices/i);
    expect(r?.answer).toMatch(/\*\*Billing/);
  });

  it('Open Paid Problem short phrase internal tracking only', () => {
    const r = det('What does Open/Paid/Problem mean?', 'agency');
    expect(r?.answer).toMatch(/internal/i);
  });
});

describe('AI setup guidance — Expanded workflow education (Client)', () => {
  it('request option uses Discover/My Projects', () => {
    const r = det('How do I request an option?', 'client');
    expect(r?.answer).toMatch(/Request option/i);
    expect(r?.answer).toMatch(/Discover|My Projects/);
    expect(r?.answer).not.toMatch(/\*\*My Models\*\*/);
  });

  it('casting client perspective', () => {
    const r = det('How does casting work?', 'client');
    expect(r?.answer).toMatch(/Request casting/i);
  });

  it('difference triple client perspective', () => {
    const r = det('What is the difference between option, casting and job?', 'client');
    expect(r?.answer).toMatch(/\*\*Job:\*\*/);
    expect(r?.answer).toMatch(/\*\*Discover\*\*|\*\*My Projects\*\*/);
    expect(
      classifyAssistantIntent(
        'What is the difference between option, casting and job?',
        'client',
        BASE_DATE,
      ).intent,
    ).toBe('help_static');
  });

  it('communicate with agencies', () => {
    const r = det('How do I communicate with agencies?', 'client');
    expect(r?.answer).toMatch(/\*\*Messages\*\*/);
  });

  it('price negotiation client no agency-internal leaks', () => {
    const r = det('How does price negotiation work?', 'client');
    expect(r?.answer).toMatch(/Request|thread|Messages/i);
    expect(r?.answer).not.toMatch(/\*\*My Models\*\*/);
    expect(r?.answer).not.toMatch(/Add Option/);
  });

  it('Explain My Projects client', () => {
    const r = det('Explain My Projects', 'client');
    expect(r?.answer).toMatch(/\*\*My Projects\*\*/);
  });

  it('Explain Discover client', () => {
    const r = det('Explain Discover', 'client');
    expect(r?.answer).toMatch(/\*\*Discover\*\*/);
  });

  it('client answer no Agency-only creation actions', () => {
    const r = det('How do I request an option?', 'client');
    expect(r?.answer).not.toMatch(/Add Option/);
    expect(r?.answer).not.toMatch(/\*\*My Models\*\*/);
  });

  it('What is My Projects routes help_static not unknown live data', () => {
    expect(classifyAssistantIntent('What is My Projects?', 'client', BASE_DATE).intent).toBe(
      'help_static',
    );
  });
});

describe('AI setup guidance — Regression routing', () => {
  it('28 calendar_summary still works for agency', () => {
    const r = classifyAssistantIntent('What do I have tomorrow?', 'agency', BASE_DATE);
    expect(r.intent).toBe('calendar_summary');
    if (r.intent === 'calendar_summary') {
      expect(r.dateRange.startDate).toBe('2026-04-30');
    }
  });

  it('29 model facts intent still routes for agency', () => {
    const r = classifyAssistantIntent('What are the measurements of Ruben E?', 'agency', BASE_DATE);
    expect(r.intent).toBe('model_visible_profile_facts');
    if (r.intent === 'model_visible_profile_facts') {
      expect(r.searchText).toMatch(/Ruben/);
    }
  });

  it('30 availability intent still routes for agency', () => {
    const r = classifyAssistantIntent('Is Aram E free on 2026-05-12?', 'agency', BASE_DATE);
    expect(r.intent).toBe('model_calendar_availability_check');
  });

  it('29b model facts refusal for client unchanged', () => {
    const exec = resolveModelFactsExecutionResult({
      role: 'client',
      facts: buildModelVisibleProfileFacts({
        rows: [{ display_name: 'X', height: 180 }],
      }),
    });
    expect(exec.type).toBe('answer');
  });

  it('32 Show my invoices still forbidden billing (live data)', () => {
    expect(classifyAssistantIntent('Show my invoices', 'agency', BASE_DATE).intent).toBe('billing');
  });
});

describe('AI setup guidance — Educational billing & team routing', () => {
  it('Where do I manage billing is help_static not billing', () => {
    expect(classifyAssistantIntent('Where do I manage billing?', 'agency', BASE_DATE).intent).toBe(
      'help_static',
    );
  });

  it('Where do I invite a booker is help_static not team_management', () => {
    expect(classifyAssistantIntent('Where do I invite a booker?', 'agency', BASE_DATE).intent).toBe(
      'help_static',
    );
  });

  it('Explain Calendar is help_static not calendar_summary', () => {
    expect(classifyAssistantIntent('Explain Calendar', 'agency', BASE_DATE).intent).toBe(
      'help_static',
    );
  });
});

describe('AI setup guidance — consent ordering (static)', () => {
  it('26-27 deterministic help runs only after consent gate in Edge handler', () => {
    const edge = readFileSync(
      path.join(process.cwd(), 'supabase/functions/ai-assistant/index.ts'),
      'utf8',
    );
    const handlerStart = edge.indexOf('Deno.serve(async');
    expect(handlerStart).toBeGreaterThan(-1);
    const gateIdx = edge.indexOf('gateAiAssistantConsent', handlerStart);
    const detIdx = edge.indexOf('tryDeterministicSetupResponse', handlerStart);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(detIdx).toBeGreaterThan(gateIdx);
  });
});

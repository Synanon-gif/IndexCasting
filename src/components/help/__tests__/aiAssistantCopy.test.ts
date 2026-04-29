import {
  getAiAssistantDisclaimer,
  getAiAssistantRoleKnowledge,
  getAiAssistantSubtitle,
  getAiAssistantTerminologyContract,
  getAiAssistantWorkflowGuidance,
  isAiAssistantLiveDataQuestion,
} from '../aiAssistantCopy';

describe('aiAssistantCopy helpers', () => {
  it('selects role-specific subtitles', () => {
    expect(getAiAssistantSubtitle('agency')).toBe('You are using IndexCasting as an Agency.');
    expect(getAiAssistantSubtitle('client')).toBe('You are using IndexCasting as a Client.');
    expect(getAiAssistantSubtitle('model')).toBe('Model account guidance');
  });

  it('uses accurate role-specific Phase 2 disclaimer copy', () => {
    const agency = getAiAssistantDisclaimer('agency');
    const client = getAiAssistantDisclaimer('client');

    expect(agency).toContain('limited calendar questions');
    expect(agency).toContain('visible facts for your agency models');
    expect(agency).toContain('I can’t perform actions');
    expect(client).toContain('limited calendar questions');
    expect(client).toContain('I can’t access agency-only model data');
    expect(client).not.toContain('visible facts for your agency models');
    expect(client).not.toContain('Agency-only visible model profile facts');
  });

  it('classifies live-data questions that must be refused', () => {
    expect(isAiAssistantLiveDataQuestion('Which bookings do I have tomorrow?')).toBe(true);
    expect(isAiAssistantLiveDataQuestion('Show my invoices')).toBe(true);
    expect(isAiAssistantLiveDataQuestion('Who is in my organization?')).toBe(true);
    expect(isAiAssistantLiveDataQuestion('What did this client say?')).toBe(true);
  });

  it('does not classify static help questions as live-data requests', () => {
    expect(isAiAssistantLiveDataQuestion('How do I create an option?')).toBe(false);
    expect(isAiAssistantLiveDataQuestion('Where can I find settings?')).toBe(false);
  });

  it('uses the real Agency option creation workflow', () => {
    const answer = getAiAssistantWorkflowGuidance('agency', 'option');

    expect(answer).toContain('CALENDAR');
    expect(answer).toContain('ADD OPTION');
    expect(answer).not.toMatch(/\bRoster\b/);
  });

  it('uses the real Agency casting creation workflow', () => {
    const answer = getAiAssistantWorkflowGuidance('agency', 'casting');

    expect(answer).toContain('CALENDAR');
    expect(answer).toContain('ADD CASTING');
    expect(answer).toContain('not the same as a confirmed booking');
  });

  it('keeps Client option guidance away from Agency-only navigation wording', () => {
    const answer = getAiAssistantWorkflowGuidance('client', 'option');

    expect(answer).toContain('Discover');
    expect(answer).toContain('My Projects');
    expect(answer).toContain('Request option');
    expect(answer).not.toContain('ADD OPTION');
    expect(answer).not.toContain('MY MODELS');
  });

  it('stores role-specific knowledge with exact Agency labels', () => {
    const agencyKnowledge = getAiAssistantRoleKnowledge('agency');
    const clientKnowledge = getAiAssistantRoleKnowledge('client');

    expect(agencyKnowledge).toContain('Dashboard');
    expect(agencyKnowledge).toContain('My Models');
    expect(agencyKnowledge).toContain('Calendar');
    expect(agencyKnowledge).toContain('ADD OPTION');
    expect(agencyKnowledge).toContain('ADD CASTING');
    expect(agencyKnowledge).not.toMatch(/\bRoster\b/);
    expect(clientKnowledge).not.toContain('MY MODELS');
    expect(clientKnowledge).not.toContain('ADD OPTION');
  });

  it('does not mix Client-only terminology into Agency knowledge', () => {
    const agencyKnowledge = getAiAssistantRoleKnowledge('agency');

    expect(agencyKnowledge).not.toContain('Discover');
    expect(agencyKnowledge).not.toContain('My Projects');
    expect(agencyKnowledge).not.toContain('Request option');
    expect(agencyKnowledge).not.toContain('Request casting');
  });

  it('does not mix Agency-only terminology into Client knowledge', () => {
    const clientKnowledge = getAiAssistantRoleKnowledge('client');

    expect(clientKnowledge).not.toContain('My Models');
    expect(clientKnowledge).not.toContain('Clients,');
    expect(clientKnowledge).not.toContain('Recruiting');
    expect(clientKnowledge).not.toContain('Links');
    expect(clientKnowledge).not.toContain('ADD OPTION');
    expect(clientKnowledge).not.toContain('ADD CASTING');
  });

  it('keeps Agency terminology contract isolated from Client navigation', () => {
    const contract = getAiAssistantTerminologyContract('agency');

    expect(contract).toContain('Allowed Agency navigation labels');
    expect(contract).toContain('My Models');
    expect(contract).toContain('Links');
    expect(contract).toContain('Never use Client-only navigation');
    expect(contract).not.toContain('Discover');
    expect(contract).not.toContain('My Projects');
  });

  it('keeps Client terminology contract isolated from Agency navigation', () => {
    const contract = getAiAssistantTerminologyContract('client');

    expect(contract).toContain('Allowed Client navigation labels');
    expect(contract).toContain('Discover');
    expect(contract).toContain('My Projects');
    expect(contract).toContain('Never use Agency-only navigation');
    expect(contract).not.toContain('My Models');
    expect(contract).not.toContain('ADD OPTION');
  });
});

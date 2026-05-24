import { legalAcceptanceCanSubmit } from '../legalAcceptanceGate';

describe('legalAcceptanceCanSubmit', () => {
  it('requires ToS and Privacy for client', () => {
    expect(
      legalAcceptanceCanSubmit(
        { role: 'client' },
        {
          tosChecked: false,
          privacyChecked: false,
          agencyRightsChecked: false,
        },
      ),
    ).toBe(false);
    expect(
      legalAcceptanceCanSubmit(
        { role: 'client' },
        {
          tosChecked: true,
          privacyChecked: true,
          agencyRightsChecked: false,
        },
      ),
    ).toBe(true);
  });

  it('requires agency model-rights checkbox for agency', () => {
    expect(
      legalAcceptanceCanSubmit(
        { role: 'agent' },
        {
          tosChecked: true,
          privacyChecked: true,
          agencyRightsChecked: false,
        },
      ),
    ).toBe(false);
    expect(
      legalAcceptanceCanSubmit(
        { role: 'agent' },
        {
          tosChecked: true,
          privacyChecked: true,
          agencyRightsChecked: true,
        },
      ),
    ).toBe(true);
  });

  it('requires ToS and Privacy for model without agency rights', () => {
    expect(
      legalAcceptanceCanSubmit(
        { role: 'model' },
        {
          tosChecked: true,
          privacyChecked: false,
          agencyRightsChecked: false,
        },
      ),
    ).toBe(false);
    expect(
      legalAcceptanceCanSubmit(
        { role: 'model' },
        {
          tosChecked: true,
          privacyChecked: true,
          agencyRightsChecked: false,
        },
      ),
    ).toBe(true);
  });
});

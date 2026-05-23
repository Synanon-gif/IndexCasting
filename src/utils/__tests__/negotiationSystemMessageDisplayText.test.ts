import { uiCopy } from '../../constants/uiCopy';
import { negotiationSystemMessageDisplayText } from '../negotiationSystemMessageDisplayText';

describe('negotiationSystemMessageDisplayText', () => {
  it('rewrites agency availability line for casting threads', () => {
    expect(
      negotiationSystemMessageDisplayText(
        uiCopy.systemMessages.agencyConfirmedAvailability,
        'casting',
      ),
    ).toBe(uiCopy.systemMessages.agencyConfirmedAvailabilityCasting);
  });

  it('rewrites no-model-account line for casting threads', () => {
    expect(
      negotiationSystemMessageDisplayText(uiCopy.systemMessages.noModelAccount, 'casting'),
    ).toBe(uiCopy.systemMessages.noModelAccountCasting);
  });

  it('leaves option threads unchanged', () => {
    expect(
      negotiationSystemMessageDisplayText(
        uiCopy.systemMessages.agencyConfirmedAvailability,
        'option',
      ),
    ).toBe(uiCopy.systemMessages.agencyConfirmedAvailability);
  });
});

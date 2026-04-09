import { uiCopy } from '../../constants/uiCopy';
import { mapAddModelToProjectErrorMessage } from '../../utils/mapAddModelToProjectErrorMessage';

describe('mapAddModelToProjectErrorMessage', () => {
  it('maps org/project/model RPC errors to specific copy', () => {
    expect(mapAddModelToProjectErrorMessage('add_model_to_project: project does not belong to caller organization')).toBe(
      uiCopy.projects.addToProjectWrongOrg,
    );
    expect(
      mapAddModelToProjectErrorMessage('add_model_to_project: caller is not a member of the specified client organization'),
    ).toBe(uiCopy.projects.addToProjectNotOrgMember);
    expect(mapAddModelToProjectErrorMessage('add_model_to_project: caller has no client organization')).toBe(
      uiCopy.projects.addToProjectNoClientOrg,
    );
    expect(mapAddModelToProjectErrorMessage('add_model_to_project: model has no agency or does not exist')).toBe(
      uiCopy.projects.addToProjectModelNoAgency,
    );
  });

  it('maps legacy pre-20260526 connection errors to generic add-to-project copy', () => {
    expect(
      mapAddModelToProjectErrorMessage(
        'add_model_to_project: no active connection to the model agency (agency_id=…)',
      ),
    ).toBe(uiCopy.projects.addToProjectGeneric);
  });

  it('maps model does not exist (unknown id) to generic', () => {
    expect(mapAddModelToProjectErrorMessage('add_model_to_project: model does not exist')).toBe(
      uiCopy.projects.addToProjectGeneric,
    );
  });

  it('maps unknown errors to generic', () => {
    expect(mapAddModelToProjectErrorMessage('something else')).toBe(uiCopy.projects.addToProjectGeneric);
    expect(mapAddModelToProjectErrorMessage(undefined)).toBe(uiCopy.projects.addToProjectGeneric);
  });

  it('uses details/hint when message alone is empty or generic (PostgREST)', () => {
    expect(
      mapAddModelToProjectErrorMessage('', {
        details: 'add_model_to_project: project does not belong to caller organization',
      }),
    ).toBe(uiCopy.projects.addToProjectWrongOrg);
    expect(
      mapAddModelToProjectErrorMessage('Error', {
        details: 'add_model_to_project: model has no agency or does not exist',
      }),
    ).toBe(uiCopy.projects.addToProjectModelNoAgency);
  });

  it('maps not_authenticated to sign-in copy', () => {
    expect(mapAddModelToProjectErrorMessage('add_model_to_project: not_authenticated')).toBe(
      uiCopy.alerts.signInRequired,
    );
  });
});

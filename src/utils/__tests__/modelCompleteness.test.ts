import { buildEditState } from '../modelEditState';
import { checkModelCompleteness, mergeModelForCompleteness } from '../modelCompleteness';

const baseCtx = { hasTerritories: true, hasVisiblePhoto: true };

describe('mergeModelForCompleteness', () => {
  it('uses in-form values so unsaved edits clear recommended issues', () => {
    const base = {
      name: 'Alex',
      email: null,
      sex: null,
      ethnicity: null,
      country_code: null,
      is_visible_fashion: true,
      is_visible_commercial: true,
    };
    const edit = buildEditState({
      name: 'Alex',
      email: 'alex@example.com',
      sex: 'female',
      ethnicity: 'Asian',
      country_code: 'DE',
    });

    const merged = mergeModelForCompleteness(base, edit);
    const issues = checkModelCompleteness(merged, baseCtx);
    const fields = issues.map((i) => i.field);

    expect(fields).not.toContain('email');
    expect(fields).not.toContain('sex');
    expect(fields).not.toContain('ethnicity');
    expect(fields).not.toContain('country_code');
  });

  it('still flags missing fields when edit form is empty', () => {
    const base = {
      name: 'Alex',
      email: null,
      sex: null,
      ethnicity: null,
      country_code: null,
      is_visible_fashion: true,
      is_visible_commercial: true,
    };
    const edit = buildEditState(base);

    const issues = checkModelCompleteness(mergeModelForCompleteness(base, edit), baseCtx);
    const fields = issues.map((i) => i.field);

    expect(fields).toContain('email');
    expect(fields).toContain('sex');
    expect(fields).toContain('ethnicity');
    expect(fields).toContain('country_code');
  });
});

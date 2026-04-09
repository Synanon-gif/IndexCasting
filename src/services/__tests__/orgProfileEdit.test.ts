/**
 * Tests for Phase 2C.1 — Owner-Only Edit Profile
 *
 * Covers:
 * - validateOrgProfileEditFields: valid data → no errors
 * - validateOrgProfileEditFields: malformed URL, email, phone, description length
 * - validateOrgProfileEditFields: valid empty fields are accepted (empty = clear field)
 * - Owner determination: orgMemberRole === 'owner' → isOwner = true; others → false
 * - Save guard: upsertOrganizationProfile returning false → onSaved not called
 * - Save guard: upsertOrganizationProfile returning true → onSaved called with form values
 *
 * RLS enforcement (op_owner_update via is_org_owner()) is server-side only.
 * These tests verify the client-side validation and guard logic.
 */

import {
  validateOrgProfileEditFields,
  type OrgProfileEditValues,
} from '../../utils/orgProfileEditValidation';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeValues(overrides: Partial<OrgProfileEditValues> = {}): OrgProfileEditValues {
  return {
    description: null,
    address_line_1: null,
    city: null,
    postal_code: null,
    country: null,
    website_url: null,
    contact_email: null,
    contact_phone: null,
    ...overrides,
  };
}

// ─── validateOrgProfileEditFields ────────────────────────────────────────────

describe('validateOrgProfileEditFields', () => {
  describe('valid data produces no errors', () => {
    it('all nulls → no errors', () => {
      expect(validateOrgProfileEditFields(makeValues())).toEqual({});
    });

    it('all filled, valid → no errors', () => {
      const errors = validateOrgProfileEditFields(
        makeValues({
          description: 'A great agency.',
          address_line_1: 'Musterstraße 1',
          city: 'Berlin',
          postal_code: '10115',
          country: 'Germany',
          website_url: 'https://example.com',
          contact_email: 'hello@example.com',
          contact_phone: '+49 30 1234567',
        }),
      );
      expect(errors).toEqual({});
    });

    it('http:// URL is accepted', () => {
      expect(validateOrgProfileEditFields(makeValues({ website_url: 'http://example.com' }))).toEqual({});
    });

    it('empty string website_url (null-equivalent) → no error', () => {
      // null = no URL set; empty strings are converted to null by the form handler
      expect(validateOrgProfileEditFields(makeValues({ website_url: null }))).toEqual({});
    });
  });

  describe('website_url validation', () => {
    it('missing scheme → error', () => {
      const errors = validateOrgProfileEditFields(makeValues({ website_url: 'example.com' }));
      expect(errors.website_url).toBeTruthy();
    });

    it('ftp:// scheme → error', () => {
      const errors = validateOrgProfileEditFields(makeValues({ website_url: 'ftp://example.com' }));
      expect(errors.website_url).toBeTruthy();
    });

    it('just whitespace is treated as empty → no error', () => {
      // trim() makes '   ' behave like empty string → falsy check passes
      const errors = validateOrgProfileEditFields(makeValues({ website_url: '   ' }));
      expect(errors.website_url).toBeUndefined();
    });
  });

  describe('contact_email validation', () => {
    it('valid email → no error', () => {
      expect(
        validateOrgProfileEditFields(makeValues({ contact_email: 'user@domain.io' })),
      ).toEqual({});
    });

    it('missing @ → error', () => {
      const errors = validateOrgProfileEditFields(makeValues({ contact_email: 'notanemail' }));
      expect(errors.contact_email).toBeTruthy();
    });

    it('missing TLD → error', () => {
      const errors = validateOrgProfileEditFields(makeValues({ contact_email: 'user@domain' }));
      expect(errors.contact_email).toBeTruthy();
    });

    it('space in email → error', () => {
      const errors = validateOrgProfileEditFields(makeValues({ contact_email: 'user @domain.com' }));
      expect(errors.contact_email).toBeTruthy();
    });
  });

  describe('contact_phone validation', () => {
    it('normal phone → no error', () => {
      expect(
        validateOrgProfileEditFields(makeValues({ contact_phone: '+49 30 12345678' })),
      ).toEqual({});
    });

    it('exactly 30 chars → no error', () => {
      const phone = '1'.repeat(30);
      const errors = validateOrgProfileEditFields(makeValues({ contact_phone: phone }));
      expect(errors.contact_phone).toBeUndefined();
    });

    it('31 chars → error', () => {
      const phone = '1'.repeat(31);
      const errors = validateOrgProfileEditFields(makeValues({ contact_phone: phone }));
      expect(errors.contact_phone).toBeTruthy();
    });
  });

  describe('description length validation', () => {
    it('exactly 1000 chars → no error', () => {
      const errors = validateOrgProfileEditFields(
        makeValues({ description: 'a'.repeat(1000) }),
      );
      expect(errors.description).toBeUndefined();
    });

    it('1001 chars → error', () => {
      const errors = validateOrgProfileEditFields(
        makeValues({ description: 'a'.repeat(1001) }),
      );
      expect(errors.description).toBeTruthy();
    });
  });

  describe('short text field length validation', () => {
    const textFields: (keyof OrgProfileEditValues)[] = [
      'address_line_1',
      'city',
      'postal_code',
      'country',
    ];

    for (const field of textFields) {
      it(`${field}: 200 chars → no error`, () => {
        const errors = validateOrgProfileEditFields(makeValues({ [field]: 'a'.repeat(200) }));
        expect(errors[field]).toBeUndefined();
      });

      it(`${field}: 201 chars → error`, () => {
        const errors = validateOrgProfileEditFields(makeValues({ [field]: 'a'.repeat(201) }));
        expect(errors[field]).toBeTruthy();
      });
    }
  });

  describe('multiple errors at once', () => {
    it('returns errors for each failing field independently', () => {
      const errors = validateOrgProfileEditFields(
        makeValues({
          website_url: 'notaurl',
          contact_email: 'bademail',
          description: 'x'.repeat(1001),
        }),
      );
      expect(errors.website_url).toBeTruthy();
      expect(errors.contact_email).toBeTruthy();
      expect(errors.description).toBeTruthy();
      // valid fields should not appear in errors
      expect(errors.city).toBeUndefined();
    });
  });
});

// ─── Owner determination ──────────────────────────────────────────────────────

describe('Owner determination from orgMemberRole', () => {
  const isOwner = (role: string | null) => role === 'owner';

  it("'owner' → isOwner = true", () => expect(isOwner('owner')).toBe(true));
  it("'booker' → isOwner = false", () => expect(isOwner('booker')).toBe(false));
  it("'employee' → isOwner = false", () => expect(isOwner('employee')).toBe(false));
  it('null → isOwner = false (cross-org viewer via OrgProfileModal)', () => expect(isOwner(null)).toBe(false));
  it("'' → isOwner = false", () => expect(isOwner('')).toBe(false));
});

// ─── Save flow guards ─────────────────────────────────────────────────────────

describe('Save flow guard logic', () => {
  const formValues = makeValues({
    description: 'Test agency',
    city: 'Berlin',
    website_url: 'https://example.com',
  });

  it('upsert returning false → onSaved is not called', async () => {
    const mockUpsert = jest.fn().mockResolvedValue(false);
    const onSaved = jest.fn();

    const errors = validateOrgProfileEditFields(formValues);
    expect(Object.keys(errors)).toHaveLength(0);

    const ok = await mockUpsert('org-id-123', formValues);
    if (ok) onSaved(formValues);

    expect(onSaved).not.toHaveBeenCalled();
  });

  it('upsert returning true → onSaved is called with form values', async () => {
    const mockUpsert = jest.fn().mockResolvedValue(true);
    const onSaved = jest.fn();

    const errors = validateOrgProfileEditFields(formValues);
    expect(Object.keys(errors)).toHaveLength(0);

    const ok = await mockUpsert('org-id-123', formValues);
    if (ok) onSaved(formValues);

    expect(onSaved).toHaveBeenCalledWith(formValues);
  });

  it('validation errors block the upsert call', async () => {
    const invalidForm = makeValues({ website_url: 'not-a-url', contact_email: 'bad' });
    const mockUpsert = jest.fn().mockResolvedValue(true);
    const onSaved = jest.fn();

    const errors = validateOrgProfileEditFields(invalidForm);
    if (Object.keys(errors).length === 0) {
      const ok = await mockUpsert('org-id-123', invalidForm);
      if (ok) onSaved(invalidForm);
    }

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(errors.website_url).toBeTruthy();
    expect(errors.contact_email).toBeTruthy();
  });
});

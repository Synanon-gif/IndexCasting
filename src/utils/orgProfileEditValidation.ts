/**
 * Validation logic for the organization profile edit form (Phase 2C.1).
 * Extracted as a pure function so it can be tested without importing React components.
 */

export interface OrgProfileEditValues {
  description: string | null;
  address_line_1: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  website_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

/**
 * Validates org profile edit form values.
 * Returns an object mapping field names to error strings (empty = valid).
 * Does NOT block saving empty fields — empty = "clear this field".
 * Only rejects fields that are non-empty but clearly malformed.
 */
export function validateOrgProfileEditFields(
  v: OrgProfileEditValues,
): Record<string, string> {
  const errors: Record<string, string> = {};

  const url = v.website_url?.trim() ?? '';
  if (url && !/^https?:\/\/.+/.test(url)) {
    errors.website_url = 'Must start with http:// or https://';
  }

  const email = v.contact_email?.trim() ?? '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.contact_email = 'Invalid email address';
  }

  const phone = v.contact_phone?.trim() ?? '';
  if (phone && phone.length > 30) {
    errors.contact_phone = 'Too long (max 30 characters)';
  }

  if (v.description && v.description.length > 1000) {
    errors.description = 'Too long (max 1000 characters)';
  }

  const shortTextFields: (keyof OrgProfileEditValues)[] = [
    'address_line_1',
    'city',
    'postal_code',
    'country',
  ];
  for (const field of shortTextFields) {
    const val = v[field];
    if (val && val.length > 200) {
      errors[field] = 'Too long (max 200 characters)';
    }
  }

  return errors;
}

/**
 * Canonical org role model + owner-only vs operational-parity gates.
 * Mirrors product rules: §8 .cursorrules (billing/member management owner-only;
 * booker/employee operational parity elsewhere).
 */
import {
  invitableRolesForOrgType,
  isAgencyOperationalMember,
  isClientOperationalMember,
  isOrganizationOwner,
  isValidRoleForOrgType,
  validRolesForOrgType,
} from '../orgRoleTypes';

describe('isValidRoleForOrgType', () => {
  it('agency accepts owner and booker only', () => {
    expect(isValidRoleForOrgType('owner', 'agency')).toBe(true);
    expect(isValidRoleForOrgType('booker', 'agency')).toBe(true);
    expect(isValidRoleForOrgType('employee', 'agency')).toBe(false);
  });

  it('client accepts owner and employee only', () => {
    expect(isValidRoleForOrgType('owner', 'client')).toBe(true);
    expect(isValidRoleForOrgType('employee', 'client')).toBe(true);
    expect(isValidRoleForOrgType('booker', 'client')).toBe(false);
  });
});

describe('validRolesForOrgType', () => {
  it('lists agency and client role sets', () => {
    expect(validRolesForOrgType('agency')).toEqual(['owner', 'booker']);
    expect(validRolesForOrgType('client')).toEqual(['owner', 'employee']);
  });
});

describe('invitableRolesForOrgType', () => {
  it('never includes owner (owner is bootstrap-only)', () => {
    expect(invitableRolesForOrgType('agency')).toEqual(['booker']);
    expect(invitableRolesForOrgType('client')).toEqual(['employee']);
    expect(invitableRolesForOrgType('agency')).not.toContain('owner');
    expect(invitableRolesForOrgType('client')).not.toContain('owner');
  });
});

describe('isOrganizationOwner — owner-only billing / invites / org delete UI', () => {
  it('is true only for owner', () => {
    expect(isOrganizationOwner('owner')).toBe(true);
    expect(isOrganizationOwner('booker')).toBe(false);
    expect(isOrganizationOwner('employee')).toBe(false);
    expect(isOrganizationOwner(null)).toBe(false);
    expect(isOrganizationOwner(undefined)).toBe(false);
    expect(isOrganizationOwner('')).toBe(false);
  });
});

describe('isAgencyOperationalMember — owner + booker parity', () => {
  it('includes owner and booker', () => {
    expect(isAgencyOperationalMember('owner')).toBe(true);
    expect(isAgencyOperationalMember('booker')).toBe(true);
    expect(isAgencyOperationalMember('employee')).toBe(false);
    expect(isAgencyOperationalMember(null)).toBe(false);
  });
});

describe('isClientOperationalMember — owner + employee parity', () => {
  it('includes owner and employee', () => {
    expect(isClientOperationalMember('owner')).toBe(true);
    expect(isClientOperationalMember('employee')).toBe(true);
    expect(isClientOperationalMember('booker')).toBe(false);
    expect(isClientOperationalMember(null)).toBe(false);
  });
});

describe('no role escalation via helpers', () => {
  it('booker cannot satisfy owner-only gate', () => {
    expect(isOrganizationOwner('booker')).toBe(false);
  });

  it('employee cannot satisfy owner-only gate', () => {
    expect(isOrganizationOwner('employee')).toBe(false);
  });
});

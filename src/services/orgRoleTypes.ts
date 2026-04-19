/**
 * Canonical Organization Role Model
 *
 * Regeln (spiegeln DB-Constraints 1:1 wider):
 *   Agency  → owner | booker
 *   Client  → owner | employee
 *
 * booker ist NICHT gültig für Client-Orgs.
 * employee ist NICHT gültig für Agency-Orgs.
 */

export type OrganizationType = 'agency' | 'client';

export type AgencyOrgMemberRole = 'owner' | 'booker';
export type ClientOrgMemberRole = 'owner' | 'employee';

/** Union aller gültigen Org-Member-Rollen. */
export type OrgMemberRole = AgencyOrgMemberRole | ClientOrgMemberRole;

/**
 * Prüft ob eine Rolle für den angegebenen Org-Typ gültig ist.
 * Spiegelt den DB-Trigger validate_org_member_role_for_type() wider.
 */
export function isValidRoleForOrgType(
  role: string,
  orgType: OrganizationType,
): role is OrgMemberRole {
  if (orgType === 'agency') {
    return role === 'owner' || role === 'booker';
  }
  if (orgType === 'client') {
    return role === 'owner' || role === 'employee';
  }
  return false;
}

/**
 * Gibt alle gültigen Rollen für einen Org-Typ zurück.
 */
export function validRolesForOrgType(orgType: OrganizationType): OrgMemberRole[] {
  if (orgType === 'agency') return ['owner', 'booker'];
  return ['owner', 'employee'];
}

/**
 * Gibt alle gültigen einladbaren Rollen (InvitationRole) für einen Org-Typ zurück.
 * Owner wird nicht per Einladung vergeben.
 */
export function invitableRolesForOrgType(orgType: OrganizationType): OrgMemberRole[] {
  if (orgType === 'agency') return ['booker'];
  return ['employee'];
}

/**
 * Organization Owner — sole role for billing checkout, team invites, org deletion,
 * and other owner-only surfaces (see `.cursorrules` §8).
 * Booker / Employee must never receive owner-only actions in UI; backend enforces the same.
 */
export function isOrganizationOwner(role: string | null | undefined): boolean {
  return role === 'owner';
}

/** Agency: owner and booker have operational parity (calendar, models, guest flows, etc.). */
export function isAgencyOperationalMember(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'booker';
}

/** Client: owner and employee have operational parity (projects, requests, calendar, etc.). */
export function isClientOperationalMember(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'employee';
}

/**
 * Org-typ-agnostischer Operational-Member-Check.
 *
 * Phase A (2026-11-20): Operational billing actions (Drafts, Line Items, Send,
 * Settlements, Presets) sind für Owner UND Booker/Employee freigegeben — siehe
 * Migration `20261120_billing_member_write_expansion.sql`. Owner-only bleiben:
 * Billing Profiles, Billing Defaults, Delete Draft, Void Invoice/Settlement.
 *
 * Mirror der DB-Helper `is_org_member()` (RLS-Policies).
 */
export function isOrganizationOperationalMember(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'booker' || role === 'employee';
}

/**
 * Typed context that a user carries after login.
 * Wird vom AuthContext geladen und gibt die vollständige Org-Identität zurück.
 */
export type UserOrgContext = {
  organization_id: string;
  org_type: OrganizationType;
  org_member_role: OrgMemberRole;
};

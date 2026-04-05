/**
 * Centralized Role Definitions — Single source of truth for all role logic.
 *
 * Mirrors the DB CHECK constraint:
 *   profiles.role IN ('admin', 'model', 'agent', 'client', 'guest')
 *
 * Design rules (from .cursorrules):
 *   - Roles describe IDENTITY, not permissions.
 *   - Permissions are enforced via RPC, RLS, and org relationships.
 *   - Discovery is global and unrestricted.
 */

/** All valid application-level roles. Mirrors profiles.role CHECK constraint. */
export type AppRole = 'admin' | 'model' | 'agent' | 'client' | 'guest';

/** Valid signup roles (subset of AppRole — admin cannot be assigned via signup). */
export type SignupRole = 'model' | 'agent' | 'client' | 'guest';

/**
 * Navigation role used by App.tsx to determine which workspace to render.
 * 'agency' maps to DB role 'agent' (legacy naming kept for nav consistency).
 * 'apply' is a transient UI state, not a DB role.
 */
export type NavigationRole = 'model' | 'agency' | 'client' | 'apply';

/** All allowed AppRole values — used for runtime validation. */
export const APP_ROLES: readonly AppRole[] = ['admin', 'model', 'agent', 'client', 'guest'] as const;

/** Allowed signup roles — 'admin' is excluded by handle_new_user trigger allowlist. */
export const SIGNUP_ROLES: readonly SignupRole[] = ['model', 'agent', 'client', 'guest'] as const;

// ── Type Guards ───────────────────────────────────────────────────────────────

/** Returns true if the input is a valid AppRole. */
export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value);
}

// ── Role Validation ───────────────────────────────────────────────────────────

/**
 * Validates and normalizes an unknown input to a valid AppRole.
 * Falls back to 'client' for invalid/unknown values (matches handle_new_user trigger).
 * Use before any DB write that involves a role value.
 */
export function validateRole(input: unknown): AppRole {
  if (isAppRole(input)) return input;
  return 'client';
}

/** AppRole or null — used at API boundaries where null signals "invalid/unknown". */
export type SafeRole = AppRole | null;

/**
 * Normalizes raw input at API/DB boundaries: trims whitespace, lowercases,
 * then validates. Returns null (with console.error) for unrecognized values.
 *
 * Catches casing bugs ('Admin' → 'admin') and whitespace (' agent ' → 'agent')
 * that would otherwise be silently swallowed by validateRole.
 *
 * For a guaranteed AppRole with 'client' fallback:
 *   const role = normalizeRole(raw) ?? 'client';
 */
export function normalizeRole(input: unknown): SafeRole {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'string') {
    console.error('[roles] normalizeRole: non-string input', input);
    return null;
  }
  const clean = input.trim().toLowerCase();
  if (isAppRole(clean)) return clean;
  console.error('[roles] normalizeRole: invalid role detected:', JSON.stringify(input));
  return null;
}

/**
 * Validates a signup role. Prevents 'admin' from being passed during signup.
 * Falls back to 'client' for any invalid or privileged value.
 */
export function validateSignupRole(input: unknown): SignupRole {
  if (
    typeof input === 'string' &&
    (SIGNUP_ROLES as readonly string[]).includes(input)
  ) {
    return input as SignupRole;
  }
  return 'client';
}

// ── Profile Role Helpers ──────────────────────────────────────────────────────

/** Minimal profile shape required by role helpers. */
type RoleCheckable = {
  role?: string | null;
  is_admin?: boolean;
  is_guest?: boolean;
};

/** Returns true if the profile belongs to the platform admin. */
export function isAdmin(profile: RoleCheckable | null | undefined): boolean {
  if (!profile) return false;
  return profile.is_admin === true || profile.role === 'admin';
}

/** Returns true if the profile is an agency/agent user. */
export function isAgency(profile: RoleCheckable | null | undefined): boolean {
  if (!profile) return false;
  return profile.role === 'agent';
}

/** Returns true if the profile is a model user. */
export function isModel(profile: RoleCheckable | null | undefined): boolean {
  if (!profile) return false;
  return profile.role === 'model';
}

/** Returns true if the profile is a client user. */
export function isClient(profile: RoleCheckable | null | undefined): boolean {
  if (!profile) return false;
  return profile.role === 'client';
}

/** Returns true if the profile is a guest user. */
export function isGuest(profile: RoleCheckable | null | undefined): boolean {
  if (!profile) return false;
  return profile.is_guest === true || profile.role === 'guest';
}

// ── Navigation Role Mapping ───────────────────────────────────────────────────

/**
 * Maps a DB profile role string to the NavigationRole used by App.tsx for routing.
 * Returns null for roles without a workspace view (admin, guest handled separately).
 */
export function roleFromProfile(profileRole: string | undefined | null): NavigationRole | null {
  if (profileRole === 'client') return 'client';
  if (profileRole === 'agent') return 'agency';
  if (profileRole === 'model') return 'model';
  return null;
}

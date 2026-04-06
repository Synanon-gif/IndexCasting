import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { uiCopy } from '../constants/uiCopy';
import { supabase } from '../../lib/supabase';
import type { Session, User } from '@supabase/supabase-js';
import type { OrganizationType, OrgMemberRole } from '../services/orgRoleTypes';
import { type AppRole, validateSignupRole, normalizeRole } from '../types/roles';

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: AppRole;
  is_active: boolean;
  is_admin: boolean;
  is_super_admin: boolean;
  is_guest: boolean;
  has_completed_signup: boolean;
  tos_accepted: boolean;
  privacy_accepted: boolean;
  agency_model_rights_accepted: boolean;
  activation_documents_sent: boolean;
  company_name: string | null;
  phone: string | null;
  website: string | null;
  country: string | null;
  verification_email: string | null;
  deletion_requested_at: string | null;
  /** Org-Kontext — null für Models und Guests (kein Org-Mitglied). */
  organization_id: string | null;
  org_type: OrganizationType | null;
  org_member_role: OrgMemberRole | null;
  /** For agency users: the agencies.id linked to their organization. Null for clients/models/guests. */
  agency_id: string | null;
};

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signUp: (
    email: string,
    password: string,
    role: string,
    displayName?: string,
    companyName?: string | null,
    options?: { isInviteSignup?: boolean }
  ) => Promise<{ error: string | null }>;
  signIn: (
    email: string,
    password: string,
    options?: { clearStaleInviteToken?: boolean }
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  acceptTerms: (agencyRights?: boolean) => Promise<{ error: string | null }>;
  markDocumentsSent: () => Promise<{ error: string | null }>;
  updateDisplayName: (name: string) => Promise<{ error: string | null }>;
  /** Set when the user was signed out due to org deactivation. Cleared on next successful sign-in. */
  orgDeactivated: boolean;
  clearOrgDeactivated: () => void;
  /**
   * true wenn der Org-Bootstrap nach Login fehlgeschlagen ist (kein Hard-Block, aber UI-Warning).
   * Nur für B2B-Rollen (client/agent). Admin-Login bleibt unberührt.
   */
  orgBootstrapFailed: boolean;
  retryOrgBootstrap: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// is_admin + is_super_admin are column-level REVOKEd from authenticated.
// They are fetched separately via get_own_admin_flags() (SECURITY DEFINER).
const PROFILE_FIELDS = 'id, email, display_name, role, is_active, is_guest, has_completed_signup, tos_accepted, privacy_accepted, agency_model_rights_accepted, activation_documents_sent, company_name, phone, website, country, verification_email, deletion_requested_at';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [orgDeactivated, setOrgDeactivated] = useState(false);
  const [orgBootstrapFailed, setOrgBootstrapFailed] = useState(false);

  const profileLoadInFlightRef = useRef(false);
  const profileRef = useRef<Profile | null>(null);

  function updateProfile(p: Profile | null) {
    profileRef.current = p;
    setProfile(p);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      console.log('[Auth] getSession resolved, user:', s?.user?.id ?? 'none');
      setSession(s);
      if (s?.user) {
        void bootstrapThenLoadProfile(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    }).catch(() => {
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      console.log('[Auth] onAuthStateChange:', event, s?.user?.id ?? 'no-user');
      setSession(s);
      if (s?.user) {
        if (profileRef.current) {
          console.log('[Auth] onAuthStateChange: profile already loaded, skipping bootstrap');
        } else if (profileLoadInFlightRef.current) {
          console.log('[Auth] onAuthStateChange: bootstrap already in flight, skipping');
        } else {
          void bootstrapThenLoadProfile(s.user.id);
        }
      } else {
        updateProfile(null);
        // Remote sign-out (e.g. member-remove Edge Function) does not run the
        // client signOut() helper — still clear cached org/client state (EXPLOIT-H1).
        if (event === 'SIGNED_OUT') {
          void (async () => {
            try {
              const { resetApplicationsStore } = await import('../store/applicationsStore');
              const { resetRecruitingChatsStore } = await import('../store/recruitingChats');
              const { resetOptionRequestsStore } = await import('../store/optionRequests');
              resetApplicationsStore();
              resetRecruitingChatsStore();
              resetOptionRequestsStore();
            } catch (e) {
              console.error('onAuthStateChange SIGNED_OUT store reset error:', e);
            }
            try {
              const { clearAllPersistence } = await import('../storage/persistence');
              clearAllPersistence();
            } catch (e) {
              console.error('onAuthStateChange SIGNED_OUT persistence clear error:', e);
            }
          })();
        }
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Returns { profile }, { deactivated: true, reason } (signs out), or null if no profile. */
  async function loadProfile(userId: string): Promise<{ profile: Profile } | { deactivated: true; reason?: 'deactivated' | 'deletion' | 'org_deactivated' } | null> {
    const { data, error: profileQueryError } = await supabase
      .from('profiles')
      .select(PROFILE_FIELDS)
      .eq('id', userId)
      .maybeSingle();
    if (profileQueryError) {
      console.error('loadProfile: profile query failed', {
        code: profileQueryError.code,
        message: profileQueryError.message,
        details: profileQueryError.details,
        hint: profileQueryError.hint,
        userId,
      });
    }
    if (!data) {
      if (profileQueryError) {
        console.warn('[Auth] loadProfile: query error but keeping existing profile (transient failure)', userId);
      } else {
        console.log('[Auth] loadProfile: no profile row found for', userId);
        updateProfile(null);
      }
      return null;
    }

    // Fetch admin flags — three independent attempts, any success is enough.
    //
    // Server-side security is enforced by UUID+email-pinned SECURITY DEFINER RPCs:
    //   get_own_admin_flags() and is_current_user_admin()
    // Both require: auth.uid() = ADMIN_UUID AND auth.users.email = ADMIN_EMAIL AND is_admin = true
    //
    // Frontend routing fallback (profile.role === 'admin') is safe:
    //   - `role` is trigger-protected: no authenticated user can change it
    //   - Frontend routing grants no database privileges; all RPCs enforce UUID+email pin
    //   - Only the real admin has role='admin' in the DB
    let isAdminFlag = false;
    let isSuperAdminFlag = false;
    try {
      // Primary: TABLE-returning RPC (returns array)
      const { data: adminFlags, error: adminErr } = await supabase.rpc('get_own_admin_flags');
      if (!adminErr && adminFlags) {
        const flags = Array.isArray(adminFlags) ? adminFlags[0] : adminFlags;
        isAdminFlag = flags?.is_admin ?? false;
        isSuperAdminFlag = flags?.is_super_admin ?? false;
      }
      if (adminErr) {
        console.error('loadProfile get_own_admin_flags error:', adminErr);
      }
    } catch (e) {
      console.error('loadProfile get_own_admin_flags exception:', e);
    }
    // Secondary: boolean RPC (different code path, same UUID+email pin in DB)
    if (!isAdminFlag) {
      try {
        const { data: isAdminBool, error: adminBoolErr } = await supabase.rpc('is_current_user_admin');
        if (!adminBoolErr && isAdminBool === true) {
          isAdminFlag = true;
        }
        if (adminBoolErr) console.error('loadProfile is_current_user_admin error:', adminBoolErr);
      } catch (e) {
        console.error('loadProfile is_current_user_admin exception:', e);
      }
    }
    // Tertiary: role field (trigger-protected — no user can write role='admin' via the API)
    // This fallback only fires if BOTH RPCs fail (e.g. transient network issue).
    if (!isAdminFlag && normalizeRole(data.role) === 'admin') {
      console.log('[Auth] loadProfile: admin detected via tertiary role fallback');
      isAdminFlag = true;
      try {
        const { data: sf } = await supabase.rpc('get_own_admin_flags');
        if (sf) {
          const row = Array.isArray(sf) ? sf[0] : sf;
          isSuperAdminFlag = row?.is_super_admin ?? false;
        }
      } catch { /* ignore */ }
    }
    console.log('[Auth] loadProfile: admin flags resolved — is_admin:', isAdminFlag, 'is_super_admin:', isSuperAdminFlag);

    const isActive = data.is_active ?? false;
    const isGuest = data.is_guest ?? false;
    const normalizedRoleInput = normalizeRole(data.role);
    if (normalizedRoleInput === null && data.role != null) {
      console.error('[AuthContext] loadProfile: unexpected role value in DB', data.role);
    }
    const role: AppRole = normalizedRoleInput ?? 'client';
    const deletionRequestedAt = data.deletion_requested_at ?? null;
    if (deletionRequestedAt) {
      await supabase.auth.signOut();
      setSession(null);
      updateProfile(null);
      return { deactivated: true, reason: 'deletion' };
    }
    // Guest accounts are always considered active — skip the activation gate.
    if (!isGuest && (role === 'client' || role === 'agent') && !isActive) {
      await supabase.auth.signOut();
      setSession(null);
      updateProfile(null);
      return { deactivated: true, reason: 'deactivated' };
    }
    // Org deactivation gate: if the user's org is deactivated, block access for all members.
    // Fail-closed: any exception (network, timeout, RPC error) is treated as deactivated to
    // prevent a deactivated org from slipping through during an outage.
    // Retries once on transient failure before failing closed.
    if (!isGuest && (role === 'client' || role === 'agent') && isActive) {
      let orgCheckPassed = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { data: orgActive, error: orgErr } = await supabase.rpc('get_my_org_active_status');
          if (orgErr) throw orgErr;
          if (orgActive === false) {
            setOrgDeactivated(true);
            await supabase.auth.signOut();
            setSession(null);
            updateProfile(null);
            return { deactivated: true, reason: 'org_deactivated' };
          }
          orgCheckPassed = true;
          break;
        } catch (e) {
          console.error(`loadProfile org active check attempt ${attempt + 1} failed:`, e);
          if (attempt < 1) await new Promise(r => setTimeout(r, 1500));
        }
      }
      if (!orgCheckPassed) {
        console.error('loadProfile org active check failed after retries — failing closed');
        setOrgDeactivated(true);
        await supabase.auth.signOut();
        setSession(null);
        updateProfile(null);
        return { deactivated: true, reason: 'org_deactivated' };
      }
    }
    // Org-Kontext laden (null für Models und Guests — kein Org-Mitglied)
    let orgContext: {
      organization_id: string | null;
      org_type: OrganizationType | null;
      org_member_role: OrgMemberRole | null;
      agency_id: string | null;
    } = {
      organization_id: null,
      org_type: null,
      org_member_role: null,
      agency_id: null,
    };
    if (!isGuest && (role === 'client' || role === 'agent')) {
      try {
        const { data: orgCtx, error: orgCtxErr } = await supabase.rpc('get_my_org_context');
        if (orgCtxErr) {
          console.error('[AuthContext] loadProfile get_my_org_context error:', orgCtxErr);
        } else if (orgCtx) {
          const allRows = Array.isArray(orgCtx) ? orgCtx : [orgCtx];
          if (allRows.length > 1) {
            console.warn(
              '[AuthContext] loadProfile: user belongs to',
              allRows.length,
              'orgs — using oldest membership (multi-org switching not yet supported)',
              allRows.map((r: Record<string, unknown>) => r.organization_id),
            );
          }
          const row = allRows[0] as Record<string, unknown> | undefined;
          if (row?.organization_id) {
            orgContext = {
              organization_id: row.organization_id as string,
              org_type: row.org_type as OrganizationType,
              org_member_role: row.org_member_role as OrgMemberRole,
              agency_id: (row.agency_id as string) ?? null,
            };
          } else {
            // Org context fehlt für einen B2B-User — Partial-State nach Signup.
            // Versuche Bootstrap einmalig, dann erneuter Fetch.
            console.error('[AuthContext] loadProfile: kein org context für role=', role, '— versuche Bootstrap-Recovery');
            try {
              // 500ms Delay vor Retry — verhindert sofortigen Fehlschlag bei transientem DB-Fehler
              await new Promise((r) => setTimeout(r, 500));
              const { ensurePlainSignupB2bOwnerBootstrap } = await import('../services/b2bOwnerBootstrapSupabase');
              const { error: bootstrapError } = await ensurePlainSignupB2bOwnerBootstrap();
              if (bootstrapError) {
                console.error('[AuthContext] loadProfile: Bootstrap-Recovery RPC fehlgeschlagen:', bootstrapError);
                setOrgBootstrapFailed(true);
              } else {
                const { data: retryCtx } = await supabase.rpc('get_my_org_context');
                const retryRows = Array.isArray(retryCtx) ? retryCtx : (retryCtx ? [retryCtx] : []);
                const retryRow = retryRows[0] as Record<string, unknown> | undefined;
                if (retryRow?.organization_id) {
                  orgContext = {
                    organization_id: retryRow.organization_id as string,
                    org_type: retryRow.org_type as OrganizationType,
                    org_member_role: retryRow.org_member_role as OrgMemberRole,
                    agency_id: (retryRow.agency_id as string) ?? null,
                  };
                  setOrgBootstrapFailed(false);
                  console.log('[AuthContext] loadProfile: org context erfolgreich wiederhergestellt');
                } else {
                  console.error('[AuthContext] loadProfile: org context fehlt auch nach Bootstrap-Recovery (role=', role, ')');
                  setOrgBootstrapFailed(true);
                }
              }
            } catch (bootstrapErr) {
              console.error('[AuthContext] loadProfile: Bootstrap-Recovery fehlgeschlagen:', bootstrapErr);
              setOrgBootstrapFailed(true);
            }
          }
        }
      } catch (e) {
        console.error('[AuthContext] loadProfile get_my_org_context exception:', e);
      }
    }

    const profileData: Profile = {
      ...data,
      role,                                            // validated AppRole (not raw string)
      is_active: isGuest ? true : isActive,
      is_admin: isAdminFlag,
      is_super_admin: isSuperAdminFlag,
      is_guest: isGuest,
      has_completed_signup: data.has_completed_signup ?? false,
      tos_accepted: data.tos_accepted ?? false,
      privacy_accepted: data.privacy_accepted ?? false,
      agency_model_rights_accepted: data.agency_model_rights_accepted ?? false,
      activation_documents_sent: data.activation_documents_sent ?? false,
      deletion_requested_at: data.deletion_requested_at ?? null,
      organization_id: orgContext.organization_id,
      org_type: orgContext.org_type,
      org_member_role: orgContext.org_member_role,
      agency_id: orgContext.agency_id,
    };
    setOrgDeactivated(false);
    console.log('[Auth] loadProfile: success, role:', profileData.role, 'is_admin:', profileData.is_admin);
    updateProfile(profileData);
    return { profile: profileData };
  }

  /** Runs after a real session exists — fixes owner bootstrap when email confirmation prevented it at signUp. */
  async function bootstrapThenLoadProfile(userId: string) {
    profileLoadInFlightRef.current = true;
    console.log('[Auth] bootstrapThenLoadProfile: starting for', userId);
    try {
      // Guest detection: handle_new_user() does NOT write is_guest from raw_user_meta_data.
      // When a guest signs in via Magic Link (OTP), is_guest is only in user_metadata.
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession?.user?.user_metadata?.is_guest === true) {
          const { createGuestProfile } = await import('../services/guestAuthSupabase');
          await createGuestProfile(
            userId,
            currentSession.user.email ?? '',
          );
        }
      } catch (e) {
        console.error('bootstrapThenLoadProfile guest upsert error:', e);
      }

      let isGuestUser = false;
      try {
        const { data: guestCheck } = await supabase
          .from('profiles')
          .select('is_guest')
          .eq('id', userId)
          .maybeSingle();
        isGuestUser = guestCheck?.is_guest === true;
      } catch {
        // Ignore — fall through to full bootstrap
      }

      if (!isGuestUser) {
        try {
          const { ensurePlainSignupB2bOwnerBootstrap } = await import('../services/b2bOwnerBootstrapSupabase');
          const { error } = await ensurePlainSignupB2bOwnerBootstrap();
          if (error) {
            console.error('bootstrapThenLoadProfile RPC error (attempt 1):', error);
            // Retry once after a delay — handles transient DB write conflicts.
            await new Promise((r) => setTimeout(r, 1500));
            const { error: retryErr } = await ensurePlainSignupB2bOwnerBootstrap();
            if (retryErr) {
              console.error('bootstrapThenLoadProfile RPC error (attempt 2, giving up):', retryErr);
              // orgBootstrapFailed wird nach loadProfile gesetzt, falls kein org context vorhanden
            }
          }
        } catch (e) {
          console.error('bootstrapThenLoadProfile exception:', e);
        }
      }
      const result = await loadProfile(userId);
      // Admin-Login bleibt unberührt (is_admin Pfad)
      if (result && 'profile' in result && result.profile && !result.profile.is_admin && result.profile.role !== 'admin') {
        const role = result.profile.role;
        if (role === 'client' || role === 'agent') {
          const hasOrg = !!(result.profile as { organization_id?: string | null }).organization_id;
          setOrgBootstrapFailed(!hasOrg);
        }
      }
      return result;
    } finally {
      profileLoadInFlightRef.current = false;
      console.log('[Auth] bootstrapThenLoadProfile: completed for', userId);
    }
  }

  const refreshProfile = useCallback(async () => {
    // getSession() reads from localStorage (no network round-trip) — cannot hang.
    // Semantically identical to getUser(): both yield the current user's ID.
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s?.user) await loadProfile(s.user.id);
  // loadProfile is defined in the same closure and stable across renders
  }, []);

  const signUp = async (
    email: string,
    password: string,
    role: string,
    displayName?: string,
    companyName?: string | null,
    options?: { isInviteSignup?: boolean }
  ) => {
    const safeRole = validateSignupRole(role);
    const trimmedCompany = companyName?.trim() || null;
    const orgNameForB2b = safeRole === 'client' || safeRole === 'agent' ? trimmedCompany : null;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: safeRole,
          display_name: displayName || email.split('@')[0],
          ...(orgNameForB2b ? { company_name: orgNameForB2b } : {}),
        },
      },
    });
    if (error) return { error: error.message };
    if (data.user) {
      const { error: pErr } = await supabase.from('profiles').upsert({
        id: data.user.id,
        email,
        display_name: displayName || email.split('@')[0],
        role: safeRole,
        is_active: safeRole === 'model',
        ...(orgNameForB2b ? { company_name: orgNameForB2b } : {}),
      });
      if (pErr) console.error('profile upsert error', pErr);

      try {
        const { clearInviteTokenIfPlainSignup } = await import('../services/authInviteTokenPolicy');
        await clearInviteTokenIfPlainSignup(options?.isInviteSignup === true);
      } catch (e) {
        console.error('signUp invite token policy error:', e);
      }

      let inviteAcceptedOk = false;
      let inviteError: string | undefined;
      try {
        const { acceptOrganizationInvitation } = await import('../services/organizationsInvitationsSupabase');
        const { readInviteToken, persistInviteToken } = await import('../storage/inviteToken');
        const tok = await readInviteToken();
        if (tok) {
          const inv = await acceptOrganizationInvitation(tok);
          inviteAcceptedOk = !!inv.ok;
          inviteError = inv.ok ? undefined : (inv.error as string | undefined);
          if (inv.ok) await persistInviteToken(null);
          // Definitiv nicht behebbar → Token leeren damit kein erneuter Versuch
          if (inviteError === 'email_mismatch' || inviteError === 'invalid_or_expired') {
            await persistInviteToken(null);
          }
        }
      } catch (e) {
        console.error('signUp invite accept error:', e);
      }

      // Wenn isInviteSignup === true aber der Invite nicht angenommen wurde (z.B. email_mismatch):
      // → KEIN Owner-Bootstrap, stattdessen Fehler zurückgeben.
      // Verhindert Zombie-Orgs für User die mit der falschen E-Mail registrieren.
      if (options?.isInviteSignup && !inviteAcceptedOk) {
        const errMsg =
          inviteError === 'email_mismatch'
            ? uiCopy.inviteErrors.emailMismatch
            : inviteError === 'invalid_or_expired'
              ? uiCopy.inviteErrors.expiredOrUsed
              : uiCopy.inviteErrors.genericFail;
        console.warn('[signUp] isInviteSignup but invite failed:', inviteError);
        return { error: errMsg };
      }

      // Org bootstrap RPCs require an active session (auth.uid() must be set).
      // When email confirmation is enabled, signUp() returns session=null and these
      // RPCs would silently fail. Guard against that — bootstrapThenLoadProfile()
      // at first login will run ensure_plain_signup_b2b_owner_bootstrap() as the
      // reliable fallback for the no-session case.
      const hasSession = !!data.session;

      // New org owners only — invited employees/bookers skip (they join an existing org).
      // !options?.isInviteSignup guard: verhindert Zombie-Org wenn Invite scheiterte.
      if (hasSession && safeRole === 'client' && !inviteAcceptedOk && !options?.isInviteSignup) {
        // Pass company name directly so the RPC doesn't need to rely on the profile
        // upsert above having committed — belt-and-suspenders against silent upsert failures.
        const { error: rpcErr } = await supabase.rpc('ensure_client_organization', {
          p_company_name: orgNameForB2b ?? null,
        });
        if (rpcErr) console.error('ensure_client_organization on signup', rpcErr);
      }
      if (hasSession && safeRole === 'agent' && !inviteAcceptedOk && !options?.isInviteSignup) {
        try {
          const { ensureAgencyRecordForCurrentAgent } = await import('../services/agenciesSupabase');
          // Pass company name directly for the same reason as above.
          const agId = await ensureAgencyRecordForCurrentAgent(orgNameForB2b);
          if (agId) {
            const { error: orgErr } = await supabase.rpc('ensure_agency_organization', { p_agency_id: agId });
            if (orgErr) console.error('ensure_agency_organization on signup', orgErr);
          }
        } catch (e) {
          console.error('agency owner bootstrap on signup', e);
        }
      }

      const { data: { session: sess } } = await supabase.auth.getSession();
      if (sess?.user) {
        await bootstrapThenLoadProfile(data.user.id);
      } else {
        await loadProfile(data.user.id);
      }
      try {
        const { linkModelByEmail } = await import('../services/modelsSupabase');
        await linkModelByEmail();
        await loadProfile(data.user.id);
      } catch (e) {
        console.error('signUp linkModelByEmail error:', e);
      }

      // Model claim token: link the newly created model account to the agency record.
      // Runs isolated — cannot block bootstrap or org invite flows.
      try {
        const { isModelClaimFlowActive, readModelClaimToken, persistModelClaimToken } =
          await import('../storage/modelClaimToken');
        const { claimModelByToken } = await import('../services/modelsSupabase');
        const claimTok = await readModelClaimToken();
        if (claimTok) {
          const claimRes = await claimModelByToken(claimTok);
          if ('modelId' in claimRes) {
            await persistModelClaimToken(null);
            await loadProfile(data.user.id);
          } else {
            console.warn('signUp claimModelByToken failed:', claimRes.error);
          }
        }
        // Suppress unused import warning
        void isModelClaimFlowActive;
      } catch (e) {
        console.error('signUp claimModelByToken error:', e);
      }
    }
    return { error: null };
  };

  const signIn = async (
    email: string,
    password: string,
    options?: { clearStaleInviteToken?: boolean }
  ) => {
    try {
      const { clearInviteTokenIfPlainSignIn } = await import('../services/authInviteTokenPolicy');
      await clearInviteTokenIfPlainSignIn(options?.clearStaleInviteToken === true);
    } catch (e) {
      console.error('signIn invite token policy error:', e);
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    // ── Step 1: profile bootstrap (ALWAYS runs — isolated from all side-effects) ──
    // This must never be skipped or blocked by any subsequent step.
    // Admin depends on this to get is_admin=true set in profile state.
    let deactivatedResult: { reason?: 'deactivated' | 'deletion' | 'org_deactivated' } | null = null;
    let bootstrapThrew = false;
    if (data?.user) {
      try {
        const result = await bootstrapThenLoadProfile(data.user.id);
        if (result && 'deactivated' in result && result.deactivated) {
          deactivatedResult = result;
        } else {
          setOrgDeactivated(false);
        }
      } catch (e) {
        console.error('signIn bootstrapThenLoadProfile error:', e);
        bootstrapThrew = true;
      }
    }

    // If bootstrap threw (network/DB crash), the session exists but profile is
    // missing. Sign out and return an error so the user can retry cleanly.
    if (bootstrapThrew) {
      try { await supabase.auth.signOut(); } catch { /* ignore sign-out error */ }
      return { error: uiCopy.auth.loginFailed };
    }

    // Return deactivation errors immediately — no further side-effects needed.
    if (deactivatedResult) {
      if (deactivatedResult.reason === 'deletion') {
        return { error: uiCopy.auth.accountScheduledForDeletion };
      }
      if (deactivatedResult.reason === 'org_deactivated') {
        return { error: uiCopy.adminDashboard.orgDeactivatedBody };
      }
      return { error: 'Your account has been deactivated. Please contact the administrator.' };
    }

    // ── Step 2: side-effects (each fully isolated, none can block Step 1) ────────
    try {
      const { acceptOrganizationInvitation } = await import('../services/organizationsInvitationsSupabase');
      const { readInviteToken, persistInviteToken, isInviteFlowActive } = await import('../storage/inviteToken');
      const tok = (await isInviteFlowActive()) ? await readInviteToken() : null;
      if (tok) {
        const inv = await acceptOrganizationInvitation(tok);
        if (inv.ok) await persistInviteToken(null);
      }
    } catch (e) {
      console.error('signIn invite accept error:', e);
    }

    try {
      const { linkModelByEmail } = await import('../services/modelsSupabase');
      await linkModelByEmail();
    } catch (e) {
      console.error('signIn linkModelByEmail error:', e);
    }

    // Model claim token: link an existing account to the agency's model record.
    // Runs isolated — cannot block bootstrap or org invite flows.
    try {
      const { isModelClaimFlowActive, readModelClaimToken, persistModelClaimToken } =
        await import('../storage/modelClaimToken');
      const { claimModelByToken } = await import('../services/modelsSupabase');
      const claimTok = (await isModelClaimFlowActive()) ? await readModelClaimToken() : null;
      if (claimTok) {
        const claimRes = await claimModelByToken(claimTok);
        if ('modelId' in claimRes) {
          await persistModelClaimToken(null);
          if (data?.user) await loadProfile(data.user.id);
        } else {
          console.warn('signIn claimModelByToken failed:', claimRes.error);
        }
      }
    } catch (e) {
      console.error('signIn claimModelByToken error:', e);
    }

    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    updateProfile(null);
    try {
      const { resetApplicationsStore } = await import('../store/applicationsStore');
      const { resetRecruitingChatsStore } = await import('../store/recruitingChats');
      const { resetOptionRequestsStore } = await import('../store/optionRequests');
      resetApplicationsStore();
      resetRecruitingChatsStore();
      resetOptionRequestsStore();
    } catch (e) {
      console.error('signOut store reset error:', e);
    }
    try {
      const { clearAllPersistence } = await import('../storage/persistence');
      clearAllPersistence();
    } catch (e) {
      console.error('signOut persistence clear error:', e);
    }
  };

  const acceptTerms = async (agencyRights = false) => {
    if (!session?.user) return { error: 'Not authenticated' };
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      tos_accepted: true,
      privacy_accepted: true,
      tos_accepted_at: now,
      privacy_accepted_at: now,
    };
    if (agencyRights) updates.agency_model_rights_accepted = true;

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', session.user.id);
    if (error) return { error: error.message };

    await supabase.from('legal_acceptances').insert([
      { user_id: session.user.id, document_type: 'terms_of_service', document_version: '1.0' },
      { user_id: session.user.id, document_type: 'privacy_policy', document_version: '1.0' },
      ...(agencyRights ? [{ user_id: session.user.id, document_type: 'agency_model_rights', document_version: '1.0' }] : []),
    ]);

    // Sync to consent_log so that GDPR withdrawal flows work.
    // consent_log is the authoritative source for withdraw_consent() RPC.
    // Errors here are non-fatal — legal_acceptances is the primary audit record.
    try {
      const { recordConsent } = await import('../services/consentSupabase');
      await recordConsent(session.user.id, 'terms', '1.0');
      await recordConsent(session.user.id, 'privacy', '1.0');
      if (agencyRights) await recordConsent(session.user.id, 'image_rights', '1.0');
    } catch (consentErr) {
      console.warn('acceptTerms: consent_log sync failed (non-fatal):', consentErr);
    }

    await loadProfile(session.user.id);
    return { error: null };
  };

  const markDocumentsSent = async () => {
    if (!session?.user) return { error: 'Not authenticated' };
    const { error } = await supabase
      .from('profiles')
      .update({ activation_documents_sent: true })
      .eq('id', session.user.id);
    if (error) return { error: error.message };
    await loadProfile(session.user.id);
    return { error: null };
  };

  const updateDisplayName = async (name: string) => {
    if (!session?.user) return { error: 'Not authenticated' };
    const trimmed = name.trim();
    if (!trimmed) return { error: 'Name must not be empty.' };
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: trimmed })
        .eq('id', session.user.id);
      if (error) return { error: error.message };
      await loadProfile(session.user.id);
      return { error: null };
    } catch (e) {
      console.error('updateDisplayName error:', e);
      return { error: 'Could not update name.' };
    }
  };

  const clearOrgDeactivated = useCallback(() => setOrgDeactivated(false), []);

  const retryOrgBootstrap = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s?.user) return;
    // Admin-Login bleibt unberührt
    if (profileRef.current?.is_admin || profileRef.current?.role === 'admin') return;
    setOrgBootstrapFailed(false);
    await bootstrapThenLoadProfile(s.user.id);
  // bootstrapThenLoadProfile ist in derselben Closure stabil
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contextValue = useMemo(() => ({
    session,
    user: session?.user ?? null,
    loading,
    signUp,
    signIn,
    signOut,
    profile,
    refreshProfile,
    acceptTerms,
    markDocumentsSent,
    updateDisplayName,
    orgDeactivated,
    clearOrgDeactivated,
    orgBootstrapFailed,
    retryOrgBootstrap,
  // Functions defined inline (signUp, signIn, signOut, acceptTerms, markDocumentsSent,
  // updateDisplayName) are recreated only when their closure deps change.
  // session, loading, profile, orgDeactivated, orgBootstrapFailed are the real state drivers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [session, loading, profile, orgDeactivated, orgBootstrapFailed]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

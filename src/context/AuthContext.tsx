import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { uiCopy } from '../constants/uiCopy';
import { supabase } from '../../lib/supabase';
import type { Session, User } from '@supabase/supabase-js';
import type { OrganizationType, OrgMemberRole } from '../services/orgRoleTypes';

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
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
};

const AuthContext = createContext<AuthState | null>(null);

const PROFILE_FIELDS = 'id, email, display_name, role, is_active, is_admin, is_super_admin, is_guest, has_completed_signup, tos_accepted, privacy_accepted, agency_model_rights_accepted, activation_documents_sent, company_name, phone, website, country, verification_email, deletion_requested_at';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [orgDeactivated, setOrgDeactivated] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) {
        void bootstrapThenLoadProfile(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    }).catch(() => {
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) void bootstrapThenLoadProfile(s.user.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  /** Returns { profile }, { deactivated: true, reason } (signs out), or null if no profile. */
  async function loadProfile(userId: string): Promise<{ profile: Profile } | { deactivated: true; reason?: 'deactivated' | 'deletion' | 'org_deactivated' } | null> {
    const { data } = await supabase
      .from('profiles')
      .select(PROFILE_FIELDS)
      .eq('id', userId)
      .maybeSingle();
    if (!data) {
      setProfile(null);
      return null;
    }
    const isActive = data.is_active ?? false;
    const isGuest = data.is_guest ?? false;
    const role = data.role;
    const deletionRequestedAt = data.deletion_requested_at ?? null;
    if (deletionRequestedAt) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      return { deactivated: true, reason: 'deletion' };
    }
    // Guest accounts are always considered active — skip the activation gate.
    if (!isGuest && (role === 'client' || role === 'agent') && !isActive) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      return { deactivated: true, reason: 'deactivated' };
    }
    // Org deactivation gate: if the user's org is deactivated, block access for all members.
    // Fail-closed: any exception (network, timeout, RPC error) is treated as deactivated to
    // prevent a deactivated org from slipping through during an outage.
    if (!isGuest && (role === 'client' || role === 'agent') && isActive) {
      try {
        const { data: orgActive, error: orgErr } = await supabase.rpc('get_my_org_active_status');
        if (orgErr) throw orgErr;
        if (orgActive === false) {
          setOrgDeactivated(true);
          await supabase.auth.signOut();
          setSession(null);
          setProfile(null);
          return { deactivated: true, reason: 'org_deactivated' };
        }
      } catch (e) {
        console.error('loadProfile org active check failed — failing closed:', e);
        setOrgDeactivated(true);
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
        return { deactivated: true, reason: 'org_deactivated' };
      }
    }
    // Org-Kontext laden (null für Models und Guests — kein Org-Mitglied)
    let orgContext: { organization_id: string | null; org_type: OrganizationType | null; org_member_role: OrgMemberRole | null } = {
      organization_id: null,
      org_type: null,
      org_member_role: null,
    };
    if (!isGuest && (role === 'client' || role === 'agent')) {
      try {
        const { data: orgCtx, error: orgCtxErr } = await supabase.rpc('get_my_org_context');
        if (orgCtxErr) {
          console.error('loadProfile get_my_org_context error:', orgCtxErr);
        } else if (orgCtx) {
          const row = Array.isArray(orgCtx) ? orgCtx[0] : orgCtx;
          if (row?.organization_id) {
            orgContext = {
              organization_id: row.organization_id as string,
              org_type: row.org_type as OrganizationType,
              org_member_role: row.org_member_role as OrgMemberRole,
            };
          }
        }
      } catch (e) {
        console.error('loadProfile get_my_org_context exception:', e);
      }
    }

    const profileData: Profile = {
      ...data,
      is_active: isGuest ? true : isActive,
      is_admin: data.is_admin ?? false,
      is_super_admin: data.is_super_admin ?? false,
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
    };
    setOrgDeactivated(false);
    setProfile(profileData);
    return { profile: profileData };
  }

  /** Runs after a real session exists — fixes owner bootstrap when email confirmation prevented it at signUp. */
  async function bootstrapThenLoadProfile(userId: string) {
    // Check if this is a guest user before running the B2B bootstrap RPC.
    // Guests have no organization and must not trigger org-creation side effects.

    // The DB trigger handle_new_user() does NOT write is_guest from raw_user_meta_data.
    // When a guest signs in via Magic Link (OTP), is_guest is only in user_metadata.
    // We upsert the profile with is_guest=true here so the DB row reflects reality
    // before we query it below.
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser?.user_metadata?.is_guest === true) {
        const { createGuestProfile } = await import('../services/guestAuthSupabase');
        await createGuestProfile(
          userId,
          currentUser.email ?? '',
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
        if (error) console.error('bootstrapThenLoadProfile RPC', error);
      } catch (e) {
        console.error('bootstrapThenLoadProfile', e);
      }
    }
    return loadProfile(userId);
  }

  const refreshProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await loadProfile(user.id);
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
    const trimmedCompany = companyName?.trim() || null;
    const orgNameForB2b = role === 'client' || role === 'agent' ? trimmedCompany : null;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role,
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
        role,
        is_active: role === 'model',
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
      try {
        const { acceptOrganizationInvitation } = await import('../services/organizationsInvitationsSupabase');
        const { readInviteToken, persistInviteToken } = await import('../storage/inviteToken');
        const tok = await readInviteToken();
        if (tok) {
          const inv = await acceptOrganizationInvitation(tok);
          inviteAcceptedOk = !!inv.ok;
          if (inv.ok) await persistInviteToken(null);
        }
      } catch (e) {
        console.error('signUp invite accept error:', e);
      }

      /** New org owners only — invited employees/bookers skip (they join an existing org). */
      if (role === 'client' && !inviteAcceptedOk) {
        const { error: rpcErr } = await supabase.rpc('ensure_client_organization');
        if (rpcErr) console.error('ensure_client_organization on signup', rpcErr);
      }
      if (role === 'agent' && !inviteAcceptedOk) {
        try {
          const { ensureAgencyRecordForCurrentAgent } = await import('../services/agenciesSupabase');
          const agId = await ensureAgencyRecordForCurrentAgent();
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
      if (data?.user) {
        const result = await bootstrapThenLoadProfile(data.user.id);
        if (result && 'deactivated' in result && result.deactivated) {
          if (result.reason === 'deletion') {
            return { error: uiCopy.auth.accountScheduledForDeletion };
          }
          if (result.reason === 'org_deactivated') {
            return { error: uiCopy.adminDashboard.orgDeactivatedBody };
          }
          return { error: 'Your account has been deactivated. Please contact the administrator.' };
        }
        setOrgDeactivated(false);
      }
    } catch (e) {
      console.error('signIn profile load error:', e);
    }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
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
  // Functions defined inline (signUp, signIn, signOut, acceptTerms, markDocumentsSent,
  // updateDisplayName) are recreated only when their closure deps change.
  // session, loading, profile, orgDeactivated are the real state drivers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [session, loading, profile, orgDeactivated]);

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

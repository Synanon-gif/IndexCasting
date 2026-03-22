import React, { createContext, useContext, useEffect, useState } from 'react';
import { uiCopy } from '../constants/uiCopy';
import { supabase } from '../../lib/supabase';
import type { Session, User } from '@supabase/supabase-js';

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  is_active: boolean;
  is_admin: boolean;
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
};

const AuthContext = createContext<AuthState | null>(null);

const PROFILE_FIELDS = 'id, email, display_name, role, is_active, is_admin, tos_accepted, privacy_accepted, agency_model_rights_accepted, activation_documents_sent, company_name, phone, website, country, verification_email, deletion_requested_at';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

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

  /** Returns { profile }, { deactivated: true, reason?: 'deactivated'|'deletion' } (signs out), or null if no profile. */
  async function loadProfile(userId: string): Promise<{ profile: Profile } | { deactivated: true; reason?: 'deactivated' | 'deletion' } | null> {
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
    const role = data.role;
    const deletionRequestedAt = data.deletion_requested_at ?? null;
    if (deletionRequestedAt) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      return { deactivated: true, reason: 'deletion' };
    }
    if ((role === 'client' || role === 'agent') && !isActive) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      return { deactivated: true, reason: 'deactivated' };
    }
    const profileData = {
      ...data,
      is_active: isActive,
      is_admin: data.is_admin ?? false,
      tos_accepted: data.tos_accepted ?? false,
      privacy_accepted: data.privacy_accepted ?? false,
      agency_model_rights_accepted: data.agency_model_rights_accepted ?? false,
      activation_documents_sent: data.activation_documents_sent ?? false,
      deletion_requested_at: data.deletion_requested_at ?? null,
    } as Profile;
    setProfile(profileData);
    return { profile: profileData };
  }

  /** Runs after a real session exists — fixes owner bootstrap when email confirmation prevented it at signUp. */
  async function bootstrapThenLoadProfile(userId: string) {
    try {
      const { ensurePlainSignupB2bOwnerBootstrap } = await import('../services/b2bOwnerBootstrapSupabase');
      const { error } = await ensurePlainSignupB2bOwnerBootstrap();
      if (error) console.error('bootstrapThenLoadProfile RPC', error);
    } catch (e) {
      console.error('bootstrapThenLoadProfile', e);
    }
    return loadProfile(userId);
  }

  const refreshProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await loadProfile(user.id);
  };

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
      } catch {}
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
          return { error: 'Your account has been deactivated. Please contact the administrator.' };
        }
      }
    } catch {}
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
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

  return (
    <AuthContext.Provider
      value={{
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

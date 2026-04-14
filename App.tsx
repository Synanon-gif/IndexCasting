import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Platform, View, StyleSheet, ActivityIndicator, Text, Dimensions, TouchableOpacity } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AppDataProvider, useAppData } from './src/context/AppDataContext';
import { SubscriptionProvider, useSubscription } from './src/context/SubscriptionContext';
import PaywallScreen from './src/screens/PaywallScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { InviteAcceptanceScreen } from './src/screens/InviteAcceptanceScreen';
import { ModelClaimScreen } from './src/screens/ModelClaimScreen';
import type { ModelClaimPreview } from './src/screens/ModelClaimScreen';
import { SetPasswordScreen } from './src/screens/SetPasswordScreen';
import { LegalAcceptanceScreen } from './src/screens/LegalAcceptanceScreen';
import { PendingActivationScreen } from './src/screens/PendingActivationScreen';
import { ClientView } from './src/views/ClientView';
import { ModelView } from './src/views/ModelView';
import { ModelAgencyProvider, useModelAgency } from './src/context/ModelAgencyContext';
import { ModelAgencySelector } from './src/screens/ModelAgencySelector';
import { AgencyView } from './src/views/AgencyView';
import { SharedSelectionView } from './src/views/SharedSelectionView';
import { BookingChatView } from './src/views/BookingChatView';
import { GuestView } from './src/views/GuestView';
import { GuestChatView } from './src/views/GuestChatView';
import { AdminDashboard } from './src/views/AdminDashboard';
import { colors } from './src/theme/theme';
import type { ClientType } from './src/views/ClientView';
import { loadClientType, saveClientType } from './src/storage/persistence';
import { supabaseUrl, supabaseAnonKey } from './src/config/env';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getInvitationPreview, type InvitationPreview } from './src/services/organizationsInvitationsSupabase';
import {
  persistInviteToken,
  markInviteFlowFromUrl,
  readInviteToken,
  peekPendingInviteTokenSync,
} from './src/storage/inviteToken';
import {
  persistModelClaimToken,
  markModelClaimFlowFromUrl,
  readModelClaimToken,
  peekPendingModelClaimTokenSync,
} from './src/storage/modelClaimToken';
import { resolveInviteAndClaimTokensForRouting } from './src/utils/inviteClaimRouting';
import { getModelClaimPreview } from './src/services/modelsSupabase';
import { finalizePendingInviteOrClaim } from './src/services/finalizePendingInviteOrClaim';
import {
  resolveInviteClaimSuccessMessage,
  resolveInviteAndClaimSuccessCombined,
} from './src/services/inviteClaimSuccessUi';
import { subscribeInviteClaimSuccess } from './src/utils/inviteClaimSuccessBus';
import { InviteClaimSuccessBanner } from './src/components/InviteClaimSuccessBanner';
import { uiCopy } from './src/constants/uiCopy';
import { initializePushNotifications, teardownPushNotifications } from './src/services/pushNotifications';
import { TermsScreen } from './src/screens/TermsScreen';
import { PrivacyScreen } from './src/screens/PrivacyScreen';
import {
  INDEXCASTING_LOCATION_EVENT,
  normalizePublicLegalPath,
  replaceWebPathToHome,
  getPublicAgencySlugFromPath,
  getPublicClientSlugFromPath,
} from './src/utils/publicLegalRoutes';
import { PublicAgencyProfileScreen } from './src/screens/PublicAgencyProfileScreen';
import { PublicClientProfileScreen } from './src/screens/PublicClientProfileScreen';
import { roleFromProfile, isAdmin, type NavigationRole } from './src/types/roles';
import {
  clampInviteOrClaimToken,
  clampQueryId,
  parseSharedSelectionParams,
} from './src/utils/queryParamGuards';

/** Web: volle Höhe sofort beim Modul-Load (vor erstem React-Paint) – verhindert weißen/leeren Screen. */
function ensureWebRootHasHeight() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const styleId = '__indexcasting_web_root_height';
  if (document.getElementById(styleId)) return;
  const el = document.createElement('style');
  el.id = styleId;
  el.textContent = `
    html, body { height: 100%; margin: 0; }
    #root { min-height: 100%; height: 100%; display: flex; flex-direction: column; }
    /* RN-Web hängt oft ein zusätzliches div unter #root */
    #root > div { flex: 1; display: flex; flex-direction: column; min-height: 100%; }
  `;
  document.head.appendChild(el);
}
ensureWebRootHasHeight();

/** Local alias kept for backwards compatibility — NavigationRole from src/types/roles.ts */
type Role = NavigationRole;

function getSharedParams(): { name: string; ids: string[]; token: string | null } | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return parseSharedSelectionParams(new URLSearchParams(window.location.search));
}

function getBookingThreadId(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  return clampQueryId(p.get('booking'));
}

function getGuestLinkId(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  return clampQueryId(p.get('guest'));
}

function getInviteTokenFromUrl(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  return clampInviteOrClaimToken(p.get('invite'));
}

function clearInviteQueryParam() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const u = new URL(window.location.href);
  if (!u.searchParams.has('invite')) return;
  u.searchParams.delete('invite');
  window.history.replaceState({}, '', u.pathname + u.search + u.hash);
}

function getModelInviteTokenFromUrl(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  return clampInviteOrClaimToken(p.get('model_invite'));
}

function clearModelInviteQueryParam() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const u = new URL(window.location.href);
  if (!u.searchParams.has('model_invite')) return;
  u.searchParams.delete('model_invite');
  window.history.replaceState({}, '', u.pathname + u.search + u.hash);
}

/** Returns true when the URL contains ?signup=1 — set by GuestView "Create a free account" button. */
function getSignupFromUrl(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('signup') === '1';
}

/** Web: URL + localStorage peek (no flash). Native: callers hydrate async. */
function computeInitialInviteClaimFromUrlAndPeek(): {
  invite: string | null;
  claim: string | null;
  inviteFromUrl: boolean;
  modelInviteFromUrl: boolean;
} {
  const urlInv = getInviteTokenFromUrl();
  const urlCl = getModelInviteTokenFromUrl();
  const { invite, claim } = resolveInviteAndClaimTokensForRouting(
    urlInv,
    urlCl,
    peekPendingInviteTokenSync(),
    peekPendingModelClaimTokenSync(),
  );
  const inviteFromUrl = Boolean(urlInv);
  const modelInviteFromUrl = Boolean(urlCl) && claim === urlCl;
  return { invite, claim, inviteFromUrl, modelInviteFromUrl };
}

/**
 * Full-app-lock for client organizations.
 *
 * When a client org's access is blocked (trial expired, no active subscription),
 * the ENTIRE client workspace is replaced with PaywallScreen — no tabs, no
 * navigation, no way to bypass via the frontend.
 *
 * Security note: this is UI-only. Every server-side RPC is independently blocked
 * via can_access_platform() so a frontend bypass attempt grants nothing.
 */
function ClientPaywallGuard({ children }: { children: React.ReactNode }) {
  const { loaded, isBlocked, isClientOrg } = useSubscription();

  if (!loaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
      </View>
    );
  }

  if (isBlocked && isClientOrg) {
    return <PaywallScreen />;
  }

  return <>{children}</>;
}

/**
 * Full-app-lock for agency organizations.
 *
 * HIGH-01 fix: Agency workspace was missing a paywall gate entirely.
 * Without this guard, agency users with an expired subscription/trial could
 * still see the full agency UI — API calls would fail via RLS, but errors
 * were silently ignored leaving users confused with a broken UI.
 *
 * This gate mirrors ClientPaywallGuard but targets agency orgs
 * (orgType === 'agency', i.e. isClientOrg === false).
 *
 * Security note: UI-only. Backend enforcement via can_access_platform() RLS.
 */
function AgencyPaywallGuard({ children }: { children: React.ReactNode }) {
  const { loaded, isBlocked, isClientOrg, orgType } = useSubscription();

  if (!loaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
      </View>
    );
  }

  if (isBlocked && orgType === 'agency' && !isClientOrg) {
    return <PaywallScreen />;
  }

  return <>{children}</>;
}

function ModelRouteGuard({
  onBackToRoleSelection,
  userId,
}: {
  onBackToRoleSelection: () => void;
  userId?: string;
}) {
  const { agencies, activeRepresentationKey, loading } = useModelAgency();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.accentBrown} />
      </View>
    );
  }

  if (agencies.length > 1 && !activeRepresentationKey) {
    return <ModelAgencySelector />;
  }

  return <ModelView onBackToRoleSelection={onBackToRoleSelection} userId={userId} />;
}

function AppContent() {
  const { session, loading, profile, signOut, refreshProfile, orgDeactivated, clearOrgDeactivated, isPasswordRecovery } = useAuth();
  const [sharedParams] = useState<{ name: string; ids: string[]; token: string | null } | null>(getSharedParams);
  const [bookingThreadId, setBookingThreadId] = useState<string | null>(getBookingThreadId);
  const [guestLinkId, setGuestLinkId] = useState<string | null>(getGuestLinkId);
  const initialRouting =
    Platform.OS === 'web'
      ? computeInitialInviteClaimFromUrlAndPeek()
      : { invite: null, claim: null, inviteFromUrl: false, modelInviteFromUrl: false };

  const [inviteTokenState, setInviteTokenState] = useState<string | null>(initialRouting.invite);
  const [modelInviteTokenState, setModelInviteTokenState] = useState<string | null>(initialRouting.claim);
  const [inviteTokenFromUrl] = useState(initialRouting.inviteFromUrl);
  const [modelInviteTokenFromUrl] = useState(initialRouting.modelInviteFromUrl);
  const [nativeInviteClaimHydrated, setNativeInviteClaimHydrated] = useState(Platform.OS === 'web');

  const [invitePreview, setInvitePreview] = useState<InvitationPreview | null>(null);
  const [invitePreviewLoading, setInvitePreviewLoading] = useState(Boolean(initialRouting.invite));
  const [invitePreviewError, setInvitePreviewError] = useState<string | null>(null);
  const [inviteAuthPhase, setInviteAuthPhase] = useState<'gate' | 'auth'>('gate');
  const [inviteAuthMode, setInviteAuthMode] = useState<'login' | 'signup'>('signup');

  // Model claim token — parallel to org invite token
  const [modelClaimPreview, setModelClaimPreview] = useState<ModelClaimPreview | null>(null);
  const [modelClaimPreviewLoading, setModelClaimPreviewLoading] = useState(Boolean(initialRouting.claim));
  const [modelClaimPreviewError, setModelClaimPreviewError] = useState<string | null>(null);
  const [modelClaimAuthPhase, setModelClaimAuthPhase] = useState<'gate' | 'auth'>('gate');
  const [modelClaimAuthMode, setModelClaimAuthMode] = useState<'login' | 'signup'>('signup');

  const [inviteClaimBannerText, setInviteClaimBannerText] = useState<string | null>(null);
  const inviteClaimBannerUserIdRef = useRef<string | null>(null);
  const inviteClaimBannerDedupRef = useRef<{ key: string; at: number } | null>(null);
  const pendingInviteOrgIdForBannerRef = useRef<string | null>(null);
  const inviteClaimBannerDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const INVITE_SUCCESS_BANNER_DEBOUNCE_MS = 700;

  const [clientType, setClientTypeState] = useState<ClientType>(() => loadClientType() ?? 'fashion');
  const { setCurrentUserId } = useAppData();

  /** Web: re-render when pathname changes to /terms or /privacy (client-side navigation). */
  const [, setWebPathTick] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const bump = () => setWebPathTick((n) => n + 1);
    window.addEventListener('popstate', bump);
    window.addEventListener(INDEXCASTING_LOCATION_EVENT, bump);
    return () => {
      window.removeEventListener('popstate', bump);
      window.removeEventListener(INDEXCASTING_LOCATION_EVENT, bump);
    };
  }, []);

  const effectiveRole: Role | null = roleFromProfile(profile?.role);

  inviteClaimBannerUserIdRef.current = session?.user?.id ?? null;

  useEffect(() => {
    return subscribeInviteClaimSuccess((payload) => {
      const uid = inviteClaimBannerUserIdRef.current;
      if (!uid) return;

      if (payload.kind === 'claim') {
        const pendingOrg = pendingInviteOrgIdForBannerRef.current;
        if (pendingOrg) {
          pendingInviteOrgIdForBannerRef.current = null;
          if (inviteClaimBannerDelayRef.current) {
            clearTimeout(inviteClaimBannerDelayRef.current);
            inviteClaimBannerDelayRef.current = null;
          }
          const key = `ic:${pendingOrg}:${payload.modelId}:${payload.agencyId}`;
          const now = Date.now();
          const prev = inviteClaimBannerDedupRef.current;
          if (prev && prev.key === key && now - prev.at < 4000) return;
          inviteClaimBannerDedupRef.current = { key, at: now };
          void (async () => {
            try {
              const text = await resolveInviteAndClaimSuccessCombined(pendingOrg, payload, uid);
              setInviteClaimBannerText(text);
            } catch (e) {
              console.error('[App] resolveInviteAndClaimSuccessCombined:', e);
              setInviteClaimBannerText(uiCopy.app.inviteClaimSuccessFallback);
            }
          })();
          return;
        }

        const key = `c:${payload.modelId}:${payload.agencyId}`;
        const now = Date.now();
        const prev = inviteClaimBannerDedupRef.current;
        if (prev && prev.key === key && now - prev.at < 4000) return;
        inviteClaimBannerDedupRef.current = { key, at: now };
        void (async () => {
          try {
            const text = await resolveInviteClaimSuccessMessage(payload, uid);
            setInviteClaimBannerText(text);
          } catch (e) {
            console.error('[App] resolveInviteClaimSuccessMessage:', e);
            setInviteClaimBannerText(uiCopy.app.inviteClaimSuccessFallback);
          }
        })();
        return;
      }

      const key = `i:${payload.organizationId}`;
      const now = Date.now();
      const prev = inviteClaimBannerDedupRef.current;
      if (prev && prev.key === key && now - prev.at < 4000) return;

      pendingInviteOrgIdForBannerRef.current = payload.organizationId;
      if (inviteClaimBannerDelayRef.current) clearTimeout(inviteClaimBannerDelayRef.current);
      inviteClaimBannerDelayRef.current = setTimeout(() => {
        inviteClaimBannerDelayRef.current = null;
        if (pendingInviteOrgIdForBannerRef.current !== payload.organizationId) return;
        pendingInviteOrgIdForBannerRef.current = null;
        inviteClaimBannerDedupRef.current = { key, at: Date.now() };
        void (async () => {
          try {
            const text = await resolveInviteClaimSuccessMessage(
              { kind: 'invite', organizationId: payload.organizationId },
              uid,
            );
            setInviteClaimBannerText(text);
          } catch (e) {
            console.error('[App] resolveInviteClaimSuccessMessage (invite-only):', e);
            setInviteClaimBannerText(uiCopy.app.inviteClaimSuccessFallback);
          }
        })();
      }, INVITE_SUCCESS_BANNER_DEBOUNCE_MS);
    });
  }, []);

  // Native: async read storage so routing matches finalizePendingInviteOrClaim (no URL on native).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    void (async () => {
      try {
        const urlInv = getInviteTokenFromUrl();
        const urlCl = getModelInviteTokenFromUrl();
        const storeInv = await readInviteToken();
        const storeCl = await readModelClaimToken();
        const { invite, claim } = resolveInviteAndClaimTokensForRouting(urlInv, urlCl, storeInv, storeCl);
        if (!cancelled) {
          setInviteTokenState(invite);
          setModelInviteTokenState(claim);
        }
      } finally {
        // Always unblock (Strict Mode double-invoke: first run cancelled must not leave spinner stuck).
        setNativeInviteClaimHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Computed early (before hooks) so it can be used in useEffect and render guards.
  // True when the user is fully authenticated and NOT a Magic-Link guest.
  const isAuthenticatedNonGuest = !!session && !!profile && profile.is_guest !== true;

  const setClientType = (value: ClientType) => {
    setClientTypeState(value);
    saveClientType(value);
  };

  // When an authenticated non-guest user lands with ?guest= in the URL
  // (e.g. they bookmarked a shared link or an old tab reopened), silently strip
  // the parameter so the normal workspace renders and no GuestView flash occurs.
  useEffect(() => {
    if (!isAuthenticatedNonGuest) return;
    if (!guestLinkId) return;
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const u = new URL(window.location.href);
    if (u.searchParams.has('guest')) {
      u.searchParams.delete('guest');
      window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    }
  }, [isAuthenticatedNonGuest, guestLinkId]);

  // Restore pending guest link after signup: if user signed up from GuestView,
  // the link ID was persisted to localStorage. On the next authenticated mount,
  // restore it so the user can return to the package they were viewing.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (guestLinkId) return;
    if (!session) return;
    try {
      const pending = localStorage.getItem('ic_pending_guest_link');
      if (!pending) return;
      localStorage.removeItem('ic_pending_guest_link');
      const u = new URL(window.location.href);
      u.searchParams.set('guest', pending);
      window.history.replaceState({}, '', u.pathname + u.search + u.hash);
      setGuestLinkId(pending);
    } catch { /* best-effort */ }
  }, [session, guestLinkId]);

  useEffect(() => {
    if (!inviteTokenState) return;
    let cancelled = false;
    void (async () => {
      await persistInviteToken(inviteTokenState);
      if (inviteTokenFromUrl) await markInviteFlowFromUrl();
      if (cancelled) return;
      setInvitePreviewLoading(true);
      try {
        const p = await getInvitationPreview(inviteTokenState);
        if (cancelled) return;
        setInvitePreview(p);
        setInvitePreviewError(p ? null : uiCopy.invite.invalidOrExpired);
      } catch {
        if (cancelled) return;
        setInvitePreviewError(uiCopy.invite.loadFailed);
      } finally {
        if (!cancelled) setInvitePreviewLoading(false);
      }
      if (session?.user && !cancelled) {
        const r = await finalizePendingInviteOrClaim({
          showUiAlerts: true,
          signOut,
          onSuccessReloadProfile: refreshProfile,
        });
        if (r.invite.ok) clearInviteQueryParam();
        if (r.claim.ok) clearModelInviteQueryParam();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteTokenState, inviteTokenFromUrl, session?.user?.id, refreshProfile, signOut]);

  // ── Model Claim Token Flow (parallel to org invite) ──────────────────────

  useEffect(() => {
    if (!modelInviteTokenState) return;
    let cancelled = false;
    void (async () => {
      await persistModelClaimToken(modelInviteTokenState);
      if (modelInviteTokenFromUrl) await markModelClaimFlowFromUrl();
      if (cancelled) return;
      setModelClaimPreviewLoading(true);
      try {
        const p = await getModelClaimPreview(modelInviteTokenState);
        if (cancelled) return;
        if (p && p.valid) {
          setModelClaimPreview(p);
          setModelClaimPreviewError(null);
        } else {
          setModelClaimPreview(p);
          setModelClaimPreviewError(uiCopy.modelClaim.invalidOrExpired);
        }
      } catch {
        if (cancelled) return;
        setModelClaimPreviewError(uiCopy.modelClaim.loadFailed);
      } finally {
        if (!cancelled) setModelClaimPreviewLoading(false);
      }
      if (session?.user && !cancelled) {
        const r = await finalizePendingInviteOrClaim({
          showUiAlerts: true,
          onSuccessReloadProfile: refreshProfile,
        });
        if (r.invite.ok) clearInviteQueryParam();
        if (r.claim.ok) clearModelInviteQueryParam();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelInviteTokenState, modelInviteTokenFromUrl, session?.user?.id, refreshProfile]);

  useEffect(() => {
    if (!effectiveRole || effectiveRole === 'apply') setCurrentUserId(null);
    else if (session?.user) setCurrentUserId(session.user.id);
  }, [effectiveRole, session, setCurrentUserId]);

  // If session is set but profile remains null, retry loading every 4 s.
  // After 8 failed retries (32 s total) force sign-out so the user is never stuck.
  // Uses setInterval + a counter ref so retries happen even when profile stays null
  // (setState(null) on an already-null value doesn't trigger a re-render).
  const profileRetryCountRef = React.useRef(0);
  useEffect(() => {
    if (!session?.user?.id) { profileRetryCountRef.current = 0; return; }
    if (profile) { profileRetryCountRef.current = 0; return; }

    const interval = setInterval(() => {
      if (profileRetryCountRef.current >= 8) {
        clearInterval(interval);
        console.error('[Auth] Profile load failed after 8 retries — signing out');
        void signOut();
        return;
      }
      profileRetryCountRef.current += 1;
      console.warn(`[Auth] Profile retry ${profileRetryCountRef.current}/8`);
      void refreshProfile();
    }, 4000);
    return () => clearInterval(interval);
  // signOut / refreshProfile are stable; only session.user.id and profile matter
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, profile]);

  // Register Expo push token once a real (non-guest) session is active.
  // Deregister on logout (session cleared) to stop delivering pushes to this device.
  useEffect(() => {
    if (isAuthenticatedNonGuest) {
      void initializePushNotifications();
    } else if (!session) {
      void teardownPushNotifications();
    }
  }, [isAuthenticatedNonGuest, session]);

  const inviteSuccessBanner =
    session && inviteClaimBannerText ? (
      <InviteClaimSuccessBanner
        message={inviteClaimBannerText}
        onDismiss={() => setInviteClaimBannerText(null)}
      />
    ) : null;

  if (loading) {
    return (
      <View style={[styles.shell, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
      </View>
    );
  }

  // Org-deactivation gate: shown briefly before the session clears, then user lands on AuthScreen.
  if (orgDeactivated) {
    return (
      <>
        <View style={[styles.shell, { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }]}>
          <Text style={{ fontSize: 28, marginBottom: 16 }}>🔒</Text>
          <Text style={{ fontWeight: '700', fontSize: 18, color: colors.textPrimary, marginBottom: 12, textAlign: 'center' }}>
            {uiCopy.adminDashboard.orgDeactivatedTitle}
          </Text>
          <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 28 }}>
            {uiCopy.adminDashboard.orgDeactivatedBody}
          </Text>
          <TouchableOpacity
            onPress={() => { clearOrgDeactivated(); void signOut(); }}
            style={{ paddingVertical: 12, paddingHorizontal: 32, backgroundColor: colors.textPrimary, borderRadius: 8 }}
          >
            <Text style={{ fontWeight: '600', color: colors.surface }}>Sign Out</Text>
          </TouchableOpacity>
        </View>
        <StatusBar style="dark" />
      </>
    );
  }

  // Bridge the async gap: setSession fires immediately when signInWithPassword succeeds,
  // but setProfile is called asynchronously after loadProfile completes. Without this
  // guard the user briefly sees AuthScreen again, which looks like a failed login.
  // orgDeactivated is checked above, so this never masks a deactivation screen.
  // After signOut, session is null → this block is skipped → AuthScreen shown correctly.
  if (session && !profile) {
    return (
      <View style={[styles.shell, { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }]}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
        <Text style={{ marginTop: 20, fontSize: 16, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' }}>
          {uiCopy.app.profileLoadingTitle}
        </Text>
        <Text style={{ marginTop: 10, fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
          {uiCopy.app.profileLoadingHint}
        </Text>
      </View>
    );
  }

  // Guest-link URL parameter: only show GuestView for unauthenticated users or
  // users whose profile is explicitly marked as a guest (Magic-Link flow).
  // Authenticated client-org owners/employees must NOT be redirected to GuestView —
  // they open packages in-app via the Discover tab.
  if (guestLinkId && !isAuthenticatedNonGuest) {
    return (
      <>
        <GuestView linkId={guestLinkId} />
        <StatusBar style="dark" />
      </>
    );
  }

  // Booking deeplink requires an active session — unauthenticated users fall through to AuthScreen.
  if (bookingThreadId && session) {
    return (
      <>
        <View style={styles.shell}>
          <BookingChatView
            threadId={bookingThreadId}
            fromRole="model"
            onClose={() => {
              if (Platform.OS === 'web' && typeof window !== 'undefined') {
                window.history.replaceState({}, '', window.location.pathname || '/');
              }
              setBookingThreadId(null);
            }}
          />
        </View>
        <StatusBar style="dark" />
      </>
    );
  }

  // Authenticated guest user (Magic Link) → limited-access chat view.
  // Must come before the regular role-based routing to prevent accidental access.
  if (session && profile?.is_guest === true) {
    return (
      <>
        <View style={styles.shell}>
          <GuestChatView />
        </View>
        <StatusBar style="dark" />
      </>
    );
  }

  // Public agency profile route: /agency/:slug — no auth required.
  // Checked here (after guest/booking checks) so both authenticated and
  // unauthenticated users can visit a public agency profile directly.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const agencySlug = getPublicAgencySlugFromPath(window.location.pathname);
    if (agencySlug) {
      return (
        <>
          <PublicAgencyProfileScreen
            slug={agencySlug}
            onClose={replaceWebPathToHome}
          />
          <StatusBar style="dark" />
        </>
      );
    }
  }

  // Public client profile route: /client/:slug — no auth required.
  // Checked immediately after the agency route so both authenticated and
  // unauthenticated users can visit a public client profile directly.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const clientSlug = getPublicClientSlugFromPath(window.location.pathname);
    if (clientSlug) {
      return (
        <>
          <PublicClientProfileScreen
            slug={clientSlug}
            onClose={replaceWebPathToHome}
          />
          <StatusBar style="dark" />
        </>
      );
    }
  }

  // Shared selection links are publicly browsable (no login required).
  // Actions (Chat, Option, Add to Selection, Star) are gated — the view
  // shows a sign-up prompt when an unauthenticated user attempts an action.
  if (sharedParams) {
    return (
      <>
        <SharedSelectionView shareName={sharedParams.name} modelIds={sharedParams.ids} token={sharedParams.token} />
        <StatusBar style="dark" />
      </>
    );
  }

  if (!session) {
    // Public legal routes (web): /terms and /privacy render full-screen without auth.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const legal = normalizePublicLegalPath(window.location.pathname);
      if (legal === 'terms') {
        return (
          <>
            <TermsScreen onClose={replaceWebPathToHome} />
            <StatusBar style="dark" />
          </>
        );
      }
      if (legal === 'privacy') {
        return (
          <>
            <PrivacyScreen onClose={replaceWebPathToHome} />
            <StatusBar style="dark" />
          </>
        );
      }
    }

    // Native: wait for AsyncStorage invite/claim read so AuthScreen does not clear stale tokens early.
    if (!nativeInviteClaimHydrated) {
      return (
        <>
          <View style={[styles.shell, { justifyContent: 'center', alignItems: 'center' }]}>
            <ActivityIndicator size="large" color={colors.textPrimary} />
          </View>
          <StatusBar style="dark" />
        </>
      );
    }

    const inviteLockedRole =
      invitePreview?.org_type === 'agency' ? 'agent' : invitePreview?.org_type === 'client' ? 'client' : undefined;
    const inviteRoleLabel =
      invitePreview?.invite_role === 'booker'
        ? uiCopy.invite.roleBookerAgency
        : invitePreview?.invite_role === 'employee'
          ? uiCopy.invite.roleEmployeeClient
          : uiCopy.invite.roleMember;

    // Model claim gate — before login when model claim token is in URL or persisted storage
    // Show gate screen also on error so the user is not dropped to a bare AuthScreen without context.
    if (modelInviteTokenState && modelClaimAuthPhase === 'gate' && (modelClaimPreviewLoading || modelClaimPreview || modelClaimPreviewError)) {
      return (
        <>
          <ModelClaimScreen
            preview={modelClaimPreview}
            loading={modelClaimPreviewLoading}
            error={modelClaimPreviewError}
            onContinueSignup={() => {
              setModelClaimAuthMode('signup');
              setModelClaimAuthPhase('auth');
            }}
            onContinueLogin={() => {
              setModelClaimAuthMode('login');
              setModelClaimAuthPhase('auth');
            }}
          />
          <StatusBar style="dark" />
        </>
      );
    }

    // Show gate screen also on error so the user is not dropped to a bare AuthScreen without context.
    if (inviteTokenState && inviteAuthPhase === 'gate' && (invitePreviewLoading || invitePreview || invitePreviewError)) {
      return (
        <>
          <InviteAcceptanceScreen
            preview={invitePreview}
            loading={invitePreviewLoading}
            error={invitePreviewError}
            onContinueSignup={() => {
              setInviteAuthMode('signup');
              setInviteAuthPhase('auth');
            }}
            onContinueLogin={() => {
              setInviteAuthMode('login');
              setInviteAuthPhase('auth');
            }}
          />
          <StatusBar style="dark" />
        </>
      );
    }

    // When in model claim auth phase, force 'model' role for signup
    const isModelClaimAuth = modelInviteTokenState && modelClaimAuthPhase === 'auth';

    // ?signup=1 is set by GuestView "Create a free account" button — open AuthScreen in signup mode.
    const guestSignupMode = !inviteTokenState && !modelInviteTokenState && getSignupFromUrl();

    return (
      <>
        <AuthScreen
          initialMode={isModelClaimAuth ? modelClaimAuthMode : (guestSignupMode ? 'signup' : inviteAuthMode)}
          sharedSelectionHint={sharedParams ? uiCopy.app.sharedListSignInHint : undefined}
          clearStaleInviteOnSignIn={!inviteTokenState && !modelInviteTokenState}
          inviteAuth={
            inviteTokenState && invitePreview && inviteLockedRole
              ? {
                  orgName: invitePreview.org_name,
                  lockedProfileRole: inviteLockedRole,
                  inviteRoleLabel,
                }
              : inviteTokenState && !invitePreview
                ? {
                    orgName: '',
                    lockedProfileRole: 'client',
                    inviteRoleLabel: uiCopy.invite.roleMember,
                    fallbackBanner: uiCopy.invite.previewFailedBanner,
                  }
                : undefined
          }
          modelClaimAuth={
            isModelClaimAuth && modelClaimPreview?.valid
              ? {
                  agencyName: modelClaimPreview.agency_name ?? '',
                }
              : isModelClaimAuth && !modelClaimPreview?.valid
                ? {
                    agencyName: '',
                    fallbackBanner: uiCopy.modelClaim.previewFailedBanner,
                  }
                : undefined
          }
        />
        <StatusBar style="dark" />
      </>
    );
  }

  // PASSWORD_RECOVERY gate — highest priority after session exists.
  // When isPasswordRecovery is true the user arrived via a Supabase reset link.
  // We gate to SetPasswordScreen BEFORE any other routing (Admin, role, paywall, etc.)
  // so the user is forced to set a new password before accessing the app.
  // Security: supabase.auth.updateUser({ password }) only updates the caller's own password.
  if (isPasswordRecovery && session) {
    return (
      <>
        <SetPasswordScreen />
        <StatusBar style="dark" />
      </>
    );
  }

  // Admin check must come before effectiveRole gate: admin profiles have role='admin'
  // which does not map to any effectiveRole, causing them to be sent back to AuthScreen.
  //
  // isAdmin() checks both profile.is_admin (UUID+email-pinned SECURITY DEFINER RPC, primary)
  // and profile.role === 'admin' (DB trigger-protected fallback). Frontend routing grants
  // no DB privileges — the AdminDashboard's own RPCs enforce UUID+email pin independently.
  if (isAdmin(profile)) {
    return (
      <>
        <View style={styles.shell}>
          <AdminDashboard onLogout={signOut} />
        </View>
        <StatusBar style="dark" />
      </>
    );
  }

  if (!effectiveRole) {
    return (
      <>
        <AuthScreen
          clearStaleInviteOnSignIn={!(inviteTokenState || modelInviteTokenState)}
          sharedSelectionHint={sharedParams ? uiCopy.app.sharedListSignInHint : undefined}
        />
        <StatusBar style="dark" />
      </>
    );
  }

  if (profile) {
    if (!profile.tos_accepted || !profile.privacy_accepted) {
      return (
        <>
          {inviteSuccessBanner}
          <LegalAcceptanceScreen />
          <StatusBar style="dark" />
        </>
      );
    }

    if (!profile.is_active && (profile.role === 'client' || profile.role === 'agent')) {
      return (
        <>
          {inviteSuccessBanner}
          <PendingActivationScreen />
          <StatusBar style="dark" />
        </>
      );
    }
  }


  const handleBackToRoleSelection = () => {
    signOut();
  };

  return (
    <>
      <View style={styles.shell}>
        {inviteSuccessBanner}
        {effectiveRole === 'client' && (
          <ClientPaywallGuard>
            <ClientView
              clientType={clientType}
              onClientTypeChange={setClientType}
              onBackToRoleSelection={handleBackToRoleSelection}
            />
          </ClientPaywallGuard>
        )}
        {effectiveRole === 'model' && (
          <ModelAgencyProvider>
            <ModelRouteGuard
              onBackToRoleSelection={handleBackToRoleSelection}
              userId={session?.user?.id}
            />
          </ModelAgencyProvider>
        )}
        {effectiveRole === 'agency' && (
          <AgencyPaywallGuard>
            <AgencyView onBackToRoleSelection={handleBackToRoleSelection} />
          </AgencyPaywallGuard>
        )}
      </View>
      <StatusBar style="dark" />
    </>
  );
}

const { height: windowHeight } = Dimensions.get('window');
const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' ? { minHeight: windowHeight } : {}),
  },
});

function ConfigGuard({ children }: { children: React.ReactNode }) {
  const configured = Boolean(supabaseUrl && supabaseAnonKey);
  if (!configured) {
    return (
      <View style={[styles.shell, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <Text style={{ color: colors.textPrimary, fontSize: 16, textAlign: 'center' }}>
          {uiCopy.app.supabaseMissing}
        </Text>
        <StatusBar style="dark" />
      </View>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AppErrorBoundary>
      <ConfigGuard>
        <AuthProvider>
          <AppDataProvider>
            <SafeAreaProvider>
              <SubscriptionProvider>
                <AppContent />
              </SubscriptionProvider>
            </SafeAreaProvider>
          </AppDataProvider>
        </AuthProvider>
      </ConfigGuard>
    </AppErrorBoundary>
  );
}

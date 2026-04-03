import React, { useEffect, useState, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Platform, View, StyleSheet, ActivityIndicator, Text, Dimensions, TouchableOpacity } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AppDataProvider, useAppData } from './src/context/AppDataContext';
import { SubscriptionProvider, useSubscription } from './src/context/SubscriptionContext';
import PaywallScreen from './src/screens/PaywallScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { InviteAcceptanceScreen } from './src/screens/InviteAcceptanceScreen';
import { LegalAcceptanceScreen } from './src/screens/LegalAcceptanceScreen';
import { PendingActivationScreen } from './src/screens/PendingActivationScreen';
import { ClientView } from './src/views/ClientView';
import { ModelView } from './src/views/ModelView';
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
import {
  getInvitationPreview,
  acceptOrganizationInvitation,
  type InvitationPreview,
} from './src/services/organizationsInvitationsSupabase';
import {
  persistInviteToken,
  readInviteToken,
  markInviteFlowFromUrl,
  isInviteFlowActive,
} from './src/storage/inviteToken';
import { uiCopy } from './src/constants/uiCopy';
import { initializePushNotifications, teardownPushNotifications } from './src/services/pushNotifications';

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

type Role = 'model' | 'agency' | 'client' | 'apply';

function getSharedParams(): { name: string; ids: string[] } | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  if (p.get('shared') !== '1') return null;
  const name = p.get('name') || 'Selection';
  const ids = (p.get('ids') || '').split(',').filter(Boolean);
  return { name, ids };
}

function getBookingThreadId(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  const id = p.get('booking');
  return id && id.trim() ? id.trim() : null;
}

function getGuestLinkId(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  return p.get('guest') || null;
}

function getInviteTokenFromUrl(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  const t = p.get('invite');
  return t && t.trim() ? t.trim() : null;
}

function clearInviteQueryParam() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const u = new URL(window.location.href);
  if (!u.searchParams.has('invite')) return;
  u.searchParams.delete('invite');
  window.history.replaceState({}, '', u.pathname + u.search + u.hash);
}

function roleFromProfile(profileRole: string | undefined): Role | null {
  if (profileRole === 'client') return 'client';
  if (profileRole === 'agent') return 'agency';
  if (profileRole === 'model') return 'model';
  return null;
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

function AppContent() {
  const { session, loading, profile, signOut, refreshProfile, orgDeactivated, clearOrgDeactivated } = useAuth();
  const [sharedParams] = useState<{ name: string; ids: string[] } | null>(getSharedParams);
  const [bookingThreadId, setBookingThreadId] = useState<string | null>(getBookingThreadId);
  const [guestLinkId] = useState<string | null>(getGuestLinkId);
  const [inviteTokenState] = useState<string | null>(() => getInviteTokenFromUrl());
  const [invitePreview, setInvitePreview] = useState<InvitationPreview | null>(null);
  const [invitePreviewLoading, setInvitePreviewLoading] = useState(Boolean(inviteTokenState));
  const [invitePreviewError, setInvitePreviewError] = useState<string | null>(null);
  const [inviteAuthPhase, setInviteAuthPhase] = useState<'gate' | 'auth'>('gate');
  const [inviteAuthMode, setInviteAuthMode] = useState<'login' | 'signup'>('signup');
  const [clientType, setClientTypeState] = useState<ClientType>(() => loadClientType() ?? 'fashion');
  const { setCurrentUserId } = useAppData();

  const effectiveRole: Role | null = roleFromProfile(profile?.role);

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

  /** Drop stray invite tokens when this load is not part of an invite flow (e.g. Supabase email-confirm redirect). */
  useEffect(() => {
    void (async () => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const fromUrl = new URLSearchParams(window.location.search).get('invite');
        if (fromUrl) return;
      }
      if (await isInviteFlowActive()) return;
      await persistInviteToken(null);
    })();
  }, []);

  useEffect(() => {
    if (!inviteTokenState) return;
    void (async () => {
      await persistInviteToken(inviteTokenState);
      await markInviteFlowFromUrl();
    })();
    let cancelled = false;
    setInvitePreviewLoading(true);
    getInvitationPreview(inviteTokenState)
      .then((p) => {
        if (cancelled) return;
        setInvitePreview(p);
        setInvitePreviewError(p ? null : uiCopy.invite.invalidOrExpired);
        setInvitePreviewLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setInvitePreviewError(uiCopy.invite.loadFailed);
        setInvitePreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteTokenState]);

  const tryAcceptInviteAfterSession = useCallback(async () => {
    const tok =
      inviteTokenState ?? ((await isInviteFlowActive()) ? await readInviteToken() : null);
    if (!tok) return;
    const r = await acceptOrganizationInvitation(tok);
    if (r.ok) {
      await persistInviteToken(null);
      clearInviteQueryParam();
      await refreshProfile();
    }
  }, [inviteTokenState, refreshProfile]);

  useEffect(() => {
    if (!session?.user) return;
    void tryAcceptInviteAfterSession();
  }, [session?.user?.id, tryAcceptInviteAfterSession]);

  useEffect(() => {
    if (!effectiveRole || effectiveRole === 'apply') setCurrentUserId(null);
    else if (session?.user) setCurrentUserId(session.user.id);
  }, [effectiveRole, session, setCurrentUserId]);

  // Register Expo push token once a real (non-guest) session is active.
  // Deregister on logout (session cleared) to stop delivering pushes to this device.
  useEffect(() => {
    if (isAuthenticatedNonGuest) {
      void initializePushNotifications();
    } else if (!session) {
      void teardownPushNotifications();
    }
  }, [isAuthenticatedNonGuest, session]);

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

  if (sharedParams) {
    return (
      <>
        <SharedSelectionView shareName={sharedParams.name} modelIds={sharedParams.ids} />
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

  if (!session) {
    const inviteLockedRole =
      invitePreview?.org_type === 'agency' ? 'agent' : invitePreview?.org_type === 'client' ? 'client' : undefined;
    const inviteRoleLabel =
      invitePreview?.invite_role === 'booker'
        ? uiCopy.invite.roleBookerAgency
        : invitePreview?.invite_role === 'employee'
          ? uiCopy.invite.roleEmployeeClient
          : uiCopy.invite.roleMember;

    if (inviteTokenState && inviteAuthPhase === 'gate' && (invitePreviewLoading || invitePreview)) {
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

    return (
      <>
        <AuthScreen
          initialMode={inviteAuthMode}
          clearStaleInviteOnSignIn={!inviteTokenState}
          inviteAuth={
            inviteTokenState && invitePreview && inviteLockedRole
              ? {
                  orgName: invitePreview.org_name,
                  lockedProfileRole: inviteLockedRole,
                  inviteRoleLabel,
                }
              : undefined
          }
        />
        <StatusBar style="dark" />
      </>
    );
  }

  if (!effectiveRole) {
    return (
      <>
        <AuthScreen clearStaleInviteOnSignIn={!inviteTokenState} />
        <StatusBar style="dark" />
      </>
    );
  }

  if (profile) {
    if (!profile.tos_accepted || !profile.privacy_accepted) {
      return (
        <>
          <LegalAcceptanceScreen />
          <StatusBar style="dark" />
        </>
      );
    }

    if (profile.is_admin) {
      return (
        <>
          <View style={styles.shell}>
            <AdminDashboard onLogout={signOut} />
          </View>
          <StatusBar style="dark" />
        </>
      );
    }

    if (!profile.is_active && (profile.role === 'client' || profile.role === 'agent')) {
      return (
        <>
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
          <ModelView
            onBackToRoleSelection={handleBackToRoleSelection}
            userId={session?.user?.id}
          />
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

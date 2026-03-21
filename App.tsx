import React, { useEffect, useState, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Platform, View, StyleSheet, ActivityIndicator, Text, Dimensions } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AppDataProvider, useAppData } from './src/context/AppDataContext';
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
import { AdminDashboard } from './src/views/AdminDashboard';
import { colors } from './src/theme/theme';
import type { ClientType } from './src/views/ClientView';
import { loadClientType, saveClientType } from './src/storage/persistence';
import { supabaseUrl, supabaseAnonKey } from './src/config/env';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';
import {
  getInvitationPreview,
  acceptOrganizationInvitation,
  type InvitationPreview,
} from './src/services/organizationsInvitationsSupabase';
import { persistInviteToken, readInviteToken } from './src/storage/inviteToken';

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

const ROLE_TO_USER_ID: Record<string, string> = {
  client: 'user-client',
  agency: 'user-agent',
  model: 'user-model-1',
};

function roleFromProfile(profileRole: string | undefined): Role | null {
  if (profileRole === 'client') return 'client';
  if (profileRole === 'agent') return 'agency';
  if (profileRole === 'model') return 'model';
  return null;
}

function AppContent() {
  const { session, loading, profile, signOut, refreshProfile } = useAuth();
  const [sharedParams] = useState<{ name: string; ids: string[] } | null>(getSharedParams);
  const [bookingThreadId, setBookingThreadId] = useState<string | null>(getBookingThreadId);
  const [guestLinkId] = useState<string | null>(getGuestLinkId);
  const [inviteTokenState] = useState<string | null>(() => getInviteTokenFromUrl());
  const [invitePreview, setInvitePreview] = useState<InvitationPreview | null>(null);
  const [invitePreviewLoading, setInvitePreviewLoading] = useState(Boolean(inviteTokenState));
  const [invitePreviewError, setInvitePreviewError] = useState<string | null>(null);
  const [inviteAuthPhase, setInviteAuthPhase] = useState<'gate' | 'auth'>('gate');
  const [inviteAuthMode, setInviteAuthMode] = useState<'login' | 'signup'>('signup');
  const [demoRole, setDemoRole] = useState<Role | null>(null);
  const [clientType, setClientTypeState] = useState<ClientType>(() => loadClientType() ?? 'fashion');
  const { setCurrentUserId } = useAppData();

  const isDemo = demoRole !== null;
  const effectiveRole: Role | null = isDemo ? demoRole : roleFromProfile(profile?.role);

  const setClientType = (value: ClientType) => {
    setClientTypeState(value);
    saveClientType(value);
  };

  useEffect(() => {
    if (!inviteTokenState) return;
    void persistInviteToken(inviteTokenState);
    let cancelled = false;
    setInvitePreviewLoading(true);
    getInvitationPreview(inviteTokenState)
      .then((p) => {
        if (cancelled) return;
        setInvitePreview(p);
        setInvitePreviewError(p ? null : 'Diese Einladung ist ungültig oder abgelaufen.');
        setInvitePreviewLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setInvitePreviewError('Einladung konnte nicht geladen werden.');
        setInvitePreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteTokenState]);

  const tryAcceptInviteAfterSession = useCallback(async () => {
    const tok = inviteTokenState ?? (await readInviteToken());
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
    else if (isDemo && ROLE_TO_USER_ID[effectiveRole]) setCurrentUserId(ROLE_TO_USER_ID[effectiveRole]);
    else if (session?.user) setCurrentUserId(session.user.id);
  }, [effectiveRole, isDemo, session, setCurrentUserId]);

  if (loading) {
    return (
      <View style={[styles.shell, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
      </View>
    );
  }

  if (guestLinkId) {
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

  if (bookingThreadId) {
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

  if (!session && !isDemo) {
    const inviteLockedRole =
      invitePreview?.org_type === 'agency' ? 'agent' : invitePreview?.org_type === 'client' ? 'client' : undefined;
    const inviteRoleLabel =
      invitePreview?.invite_role === 'booker'
        ? 'Booker'
        : invitePreview?.invite_role === 'employee'
          ? 'Mitarbeiter'
          : 'Mitglied';

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
          onDemoLogin={(r) => setDemoRole(r)}
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
        <AuthScreen onDemoLogin={(r) => setDemoRole(r)} />
        <StatusBar style="dark" />
      </>
    );
  }

  if (!isDemo && profile) {
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
    if (isDemo) {
      setDemoRole(null);
    } else {
      signOut();
    }
  };

  return (
    <>
      <View style={styles.shell}>
        {effectiveRole === 'client' && (
          <ClientView
            clientType={clientType}
            onClientTypeChange={setClientType}
            onBackToRoleSelection={handleBackToRoleSelection}
          />
        )}
        {effectiveRole === 'model' && (
          <ModelView
            onBackToRoleSelection={handleBackToRoleSelection}
            userId={!isDemo && session?.user ? session.user.id : undefined}
          />
        )}
        {effectiveRole === 'agency' && <AgencyView onBackToRoleSelection={handleBackToRoleSelection} />}
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
          Supabase ist nicht konfiguriert.{'\n\n'}
          Bitte in .env.local prüfen:{'\n'}
          NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY
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
            <AppContent />
          </AppDataProvider>
        </AuthProvider>
      </ConfigGuard>
    </AppErrorBoundary>
  );
}

/**
 * GuestChatView — Limited-access chat for guest (Magic-Link) users.
 *
 * Shown immediately after the user clicks the Magic Link and is authenticated.
 * Responsibilities:
 *   1. Read the pending booking request from sessionStorage (set by GuestView)
 *   2. Resolve the agency organization ID from the guest link agency_id
 *   3. Create (or re-use) the guest ↔ agency conversation
 *   4. Send the booking_request message (once)
 *   5. Render the chat thread via OrgMessengerInline
 *   6. Show the persistent limited-access banner
 *   7. Provide the "Get full access" upgrade CTA
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput, Modal, Platform, Linking,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, typography } from '../theme/theme';
import { getChatOverlayMaxWidth } from '../theme/chatLayout';
import { uiCopy } from '../constants/uiCopy';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { validateUrl } from '../../lib/validation';
import {
  createGuestConversation,
  sendGuestBookingRequest,
  getAgencyMemberIds,
  type GuestBookingRequestPayload,
} from '../services/guestChatSupabase';
import { upgradeGuestToClient } from '../services/guestAuthSupabase';
import { OrgMessengerInline } from '../components/OrgMessengerInline';
import type { Conversation } from '../services/messengerSupabase';

const copy = uiCopy.guestFlow;

const GUEST_PENDING_KEY = 'guest_pending_request';

type PendingRequest = {
  link_id: string;
  agency_id: string;
  selected_models: string[];
  requested_date: string | null;
  message: string;
  email: string;
};

/**
 * Reads the pending guest booking request from the appropriate storage.
 * Web: sessionStorage (set synchronously by GuestView before Magic-Link redirect).
 * Native: AsyncStorage (set by GuestView before OTP auth on iOS/Android).
 */
async function readPendingRequest(): Promise<PendingRequest | null> {
  try {
    if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(GUEST_PENDING_KEY);
      return raw ? (JSON.parse(raw) as PendingRequest) : null;
    }
    // Native: AsyncStorage
    const raw = await AsyncStorage.getItem(GUEST_PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingRequest) : null;
  } catch {
    return null;
  }
}

async function clearPendingRequest(): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(GUEST_PENDING_KEY);
      return;
    }
    await AsyncStorage.removeItem(GUEST_PENDING_KEY);
  } catch {
    // Non-fatal; pending will naturally expire
  }
}

/**
 * Resolves the agency organization_id from a guest link ID via a
 * SECURITY DEFINER RPC.  This eliminates trust in the client-supplied
 * agency_id from sessionStorage: the org is derived from the verified
 * link row in the database (active, non-expired, non-deleted).
 * C-2 fix — Security Pentest 2026-04.
 */
async function getAgencyOrgIdForLink(linkId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('get_agency_org_id_for_link', {
      p_link_id: linkId,
    });
    if (error) {
      console.error('getAgencyOrgIdForLink error:', error);
      return null;
    }
    return (data as string | null) ?? null;
  } catch (e) {
    console.error('getAgencyOrgIdForLink exception:', e);
    return null;
  }
}

export const GuestChatView: React.FC = () => {
  const { width: guestWinW } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const composerBottomInset = Math.max(insets.bottom, spacing.sm);
  const upgradeModalMaxW = getChatOverlayMaxWidth(guestWinW);
  const { session, profile, refreshProfile } = useAuth();
  const userId = session?.user?.id ?? null;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [_agencyOrgId, setAgencyOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);
  const [_pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const initializingRef = useRef(false);

  // Upgrade modal state
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeCompany, setUpgradeCompany] = useState('');
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const initChat = useCallback(async () => {
    if (!userId) return;
    if (initializingRef.current) return;
    initializingRef.current = true;

    setLoading(true);
    setChatError(null);

    try {
      const pending = await readPendingRequest();
      setPendingRequest(pending);
      if (pending?.selected_models) {
        setSelectedModelIds(pending.selected_models);
      }

      const linkId = pending?.link_id ?? null;
      if (!linkId) {
        // No pending request: try to find an existing conversation
        // by scanning conversations where user is participant + guest_user_id = userId
        const { data: convs } = await supabase
          .from('conversations')
          .select('*')
          .contains('participant_ids', [userId])
          .eq('guest_user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1);
        if (convs && convs.length > 0) {
          const conv = convs[0] as Conversation;
          setConversation(conv);
          setAgencyOrgId(conv.agency_organization_id ?? null);
        }
        setLoading(false);
        return;
      }

      // Resolve agency org from the verified link (not from sessionStorage agency_id).
      // get_agency_org_id_for_link() validates the link is active + non-expired server-side.
      const orgId = await getAgencyOrgIdForLink(linkId);
      if (!orgId) {
        setChatError(copy.agencyWorkspaceNotFound);
        setLoading(false);
        return;
      }
      setAgencyOrgId(orgId);

      // Collect agency members for participant_ids
      const memberIds = await getAgencyMemberIds(orgId);

      // Create or retrieve existing conversation
      const convResult = await createGuestConversation(userId, orgId, memberIds);
      if (!convResult.ok) {
        setChatError(copy.chatError);
        setLoading(false);
        return;
      }
      setConversation(convResult.conversation);

      // Send booking request message only once (when conversation was just created)
      if (convResult.created && pending) {
        const payload: GuestBookingRequestPayload = {
          selected_models: pending.selected_models,
          requested_date: pending.requested_date,
          message: pending.message,
          guest_link_id: pending.link_id,
        };
        await sendGuestBookingRequest(convResult.conversation.id, userId, payload);
        await clearPendingRequest();
      } else if (pending && !convResult.created) {
        // Conversation existed — still clear pending to avoid re-sending on refresh
        await clearPendingRequest();
      }
    } catch (e) {
      console.error('GuestChatView initChat exception:', e);
      setChatError(copy.chatError);
    } finally {
      setLoading(false);
      initializingRef.current = false;
    }
  }, [userId]);

  useEffect(() => {
    void initChat();
  }, [initChat]);

  const handleUpgrade = async () => {
    setUpgradeError(null);
    setUpgrading(true);
    try {
      const result = await upgradeGuestToClient(upgradeCompany.trim() || undefined);
      if (!result.ok) {
        setUpgradeError(copy.upgradeError);
        return;
      }
      // Refresh profile so App.tsx routes to the full client view
      await refreshProfile();
      setShowUpgradeModal(false);
    } catch (e) {
      console.error('handleUpgrade exception:', e);
      setUpgradeError(copy.upgradeError);
    } finally {
      setUpgrading(false);
    }
  };

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
        <Text style={styles.loadingText}>{copy.loadingChat}</Text>
      </View>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────────────
  if (chatError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{chatError}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={initChat}>
          <Text style={styles.retryBtnLabel}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── No conversation yet ────────────────────────────────────────────────────
  if (!conversation) {
    return (
      <View style={styles.centered}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.subtitle}>
          {copy.noConversationHint}
        </Text>
      </View>
    );
  }

  const displayName = profile?.display_name || session?.user?.email || 'Guest';

  return (
    <View style={styles.container}>
      {/* ── Limited-access banner ── */}
      <View style={styles.banner}>
        <Text style={styles.bannerText}>{copy.banner}</Text>
        <TouchableOpacity
          style={styles.bannerCta}
          onPress={() => setShowUpgradeModal(true)}
        >
          <Text style={styles.bannerCtaText}>{copy.upgradeButton}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{copy.chatTitle}</Text>
        <Text style={styles.headerSub}>
          {displayName} · {copy.guestClientLabel}
        </Text>
      </View>

      {/* ── Selected models summary (read-only) ── */}
      {selectedModelIds.length > 0 && (
        <View style={styles.modelsSummary}>
          <Text style={styles.modelsSummaryLabel}>
            {copy.selectedModels}: {selectedModelIds.length} model(s) requested
          </Text>
        </View>
      )}

      {/* ── Chat thread ── */}
      <View style={styles.chatArea}>
        <OrgMessengerInline
          conversationId={conversation.id}
          headerTitle=""
          viewerUserId={userId}
          composerBottomInsetOverride={composerBottomInset}
          containerStyle={styles.messengerContainer}
          onPackagePress={(meta) => {
            const url = typeof meta.guest_link === 'string' ? meta.guest_link : null;
            if (url && validateUrl(url).ok) void Linking.openURL(url).catch(() => {});
          }}
        />
      </View>

      {/* ── Upgrade modal ── */}
      <Modal
        visible={showUpgradeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUpgradeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: upgradeModalMaxW }]}>
            <Text style={styles.modalTitle}>{copy.upgradeTitle}</Text>
            <Text style={styles.modalBody}>
              {copy.upgradeModalBody}
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder={copy.upgradeCompanyPlaceholder}
              placeholderTextColor={colors.textSecondary}
              value={upgradeCompany}
              onChangeText={setUpgradeCompany}
              editable={!upgrading}
            />

            {upgradeError && (
              <Text style={styles.upgradeError}>{upgradeError}</Text>
            )}

            <TouchableOpacity
              style={[styles.upgradeBtn, upgrading && styles.upgradeBtnDisabled]}
              disabled={upgrading}
              onPress={handleUpgrade}
            >
              {upgrading ? (
                <ActivityIndicator size="small" color={colors.surface} />
              ) : (
                <Text style={styles.upgradeBtnLabel}>{copy.upgradeConfirm}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => {
                setShowUpgradeModal(false);
                setUpgradeError(null);
              }}
            >
              <Text style={styles.cancelBtnLabel}>{uiCopy.common.cancel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' ? { minHeight: 0 } : {}),
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  errorText: {
    ...typography.body,
    color: '#C0392B',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  retryBtnLabel: { ...typography.label, color: colors.textPrimary },
  brand: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 360,
  },

  // Banner
  banner: {
    backgroundColor: '#FFF3CD',
    borderBottomWidth: 1,
    borderBottomColor: '#FFEAA7',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  bannerText: {
    ...typography.body,
    fontSize: 12,
    color: '#856404',
    flex: 1,
  },
  bannerCta: {
    backgroundColor: '#856404',
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: 6,
  },
  bannerCtaText: {
    ...typography.label,
    fontSize: 11,
    color: '#FFF3CD',
  },

  // Header
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...typography.heading,
    fontSize: 17,
    color: colors.textPrimary,
  },
  headerSub: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Models summary
  modelsSummary: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modelsSummaryLabel: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },

  // Chat area
  chatArea: { flex: 1, ...(Platform.OS === 'web' ? { minHeight: 0 } : {}) },
  messengerContainer: { flex: 1, ...(Platform.OS === 'web' ? { minHeight: 0 } : {}) },

  // Upgrade modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.xl,
    width: '100%',
  },
  modalTitle: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  modalBody: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    marginBottom: spacing.md,
  },
  upgradeError: {
    ...typography.body,
    color: '#C0392B',
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  upgradeBtn: {
    backgroundColor: colors.textPrimary,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  upgradeBtnDisabled: { opacity: 0.4 },
  upgradeBtnLabel: { ...typography.label, color: colors.surface },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  cancelBtnLabel: { ...typography.body, color: colors.textSecondary },
});

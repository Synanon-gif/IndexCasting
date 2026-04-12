/**
 * Booking chat (Agency–Model thread).
 * Used by the model to open a chat from "Booking chats" or from a ?booking= thread link.
 * This view is shown AFTER the agency has accepted the model's application.
 * Before acceptance, the chat is a Recruiting Chat (handled in AgencyRecruitingView).
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ScrollView, Image, Platform, ActivityIndicator, Linking, Pressable, useWindowDimensions, KeyboardAvoidingView, BackHandler } from 'react-native';
import { StorageImage } from '../components/StorageImage';
import { colors, spacing, typography } from '../theme/theme';
import { bubbleColorsForSender, outgoingSelfBubbleColors } from '../theme/roleColors';
import { CHAT_BUBBLE_MAX_WIDTH } from '../components/orgMessengerMessageLayout';
import { getChatOverlayMaxWidth, getMessagesScrollMaxHeight } from '../theme/chatLayout';
import {
  getRecruitingMessages,
  addRecruitingMessage,
  addRecruitingMessageWithFile,
  getRecruitingThread,
  subscribeRecruitingChats,
  loadMessagesForThread,
  addModelBookingThreadId,
} from '../store/recruitingChats';
import { getSignedRecruitingChatFileUrl } from '../services/recruitingChatSupabase';
import { getApplicationById } from '../store/applicationsStore';
import { getThread } from '../services/recruitingChatSupabase';
import { getAgencyChatDisplayById } from '../services/agenciesSupabase';
import { getOrganizationIdForAgency } from '../services/organizationsInvitationsSupabase';
import { OrgProfileModal } from '../components/OrgProfileModal';
import { BOTTOM_TAB_BAR_HEIGHT } from '../navigation/bottomTabNavigation';
import { supabase } from '../../lib/supabase';
import { confirmImageRights } from '../services/gdprComplianceSupabase';
import { uiCopy } from '../constants/uiCopy';
import { validateUrl, UI_DOUBLE_SUBMIT_DEBOUNCE_MS } from '../../lib/validation';

type BookingChatPresentation = 'modal' | 'insetAboveBottomNav';

type Props = {
  threadId: string;
  fromRole: 'agency' | 'model';
  onClose: () => void;
  /** Sofort angezeigter Agenturname (z. B. aus Messages-Liste), bevor Supabase antwortet. */
  initialAgencyName?: string | null;
  /** agency_id der zugehörigen Bewerbung – zuverlässiger als globaler Applications-Store. */
  applicationAgencyId?: string | null;
  /** Default `modal` (fullscreen). `insetAboveBottomNav` keeps the app bottom tab bar visible (shell layouts). */
  presentation?: BookingChatPresentation;
  /** Distance from screen bottom to reserve for the tab bar + safe area when using `insetAboveBottomNav`. */
  bottomInset?: number;
};

export const BookingChatView: React.FC<Props> = ({
  threadId,
  fromRole,
  onClose,
  initialAgencyName,
  applicationAgencyId,
  presentation = 'modal',
  bottomInset = BOTTOM_TAB_BAR_HEIGHT,
}) => {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const chatOverlayMaxWidth = getChatOverlayMaxWidth(windowWidth);
  const bookingMessagesMaxHeight = getMessagesScrollMaxHeight(windowHeight);
  const [chatInput, setChatInput] = useState('');
  const [chatInputHeight, setChatInputHeight] = useState(36);
  const [messages, setMessages] = useState(() => getRecruitingMessages(threadId));
  const [agencyName, setAgencyName] = useState<string | null>(initialAgencyName ?? null);
  const [agencyLogoUrl, setAgencyLogoUrl] = useState<string | null>(null);
  const [agencyOrgIdForProfile, setAgencyOrgIdForProfile] = useState<string | null>(null);
  const [showAgencyProfile, setShowAgencyProfile] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fileRightsConfirmed, setFileRightsConfirmed] = useState(false);
  /** Web-only: consent row is only shown after a file has been selected. */
  const [showConsentRow, setShowConsentRow] = useState(false);
  /** Web-only: file awaiting consent confirmation before upload. */
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Blocks rapid double-send (client-side only; not server rate limiting). */
  const lastSendAtRef = useRef(0);
  const thread = getRecruitingThread(threadId);
  const application = thread ? getApplicationById(thread.applicationId) : undefined;

  useEffect(() => {
    if (initialAgencyName) setAgencyName(initialAgencyName);
  }, [initialAgencyName]);

  useEffect(() => {
    if (fromRole === 'model') addModelBookingThreadId(threadId);
  }, [threadId, fromRole]);

  useEffect(() => {
    const refresh = () => setMessages(getRecruitingMessages(threadId));
    loadMessagesForThread(threadId).then(() => refresh());
    const unsub = subscribeRecruitingChats(refresh);
    return unsub;
  }, [threadId]);

  useEffect(() => {
    if (fromRole !== 'model') return;
    const fromApp = applicationAgencyId?.trim() || application?.agencyId || null;
    const loadDisplay = (agencyId: string) => {
      getAgencyChatDisplayById(agencyId).then((row) => {
        if (row?.name) setAgencyName(row.name);
        setAgencyLogoUrl(row?.logo_url ?? null);
      });
      getOrganizationIdForAgency(agencyId).then((orgId) => {
        setAgencyOrgIdForProfile(orgId);
      });
    };
    if (fromApp) {
      loadDisplay(fromApp);
      return;
    }
    getThread(threadId).then((t) => {
      if (t?.agency_id) loadDisplay(t.agency_id);
    });
  }, [threadId, fromRole, applicationAgencyId, application?.agencyId]);

  // Resolve signed URLs for file attachments
  useEffect(() => {
    let cancelled = false;
    const paths = messages
      .map((m) => m.fileUrl)
      .filter((p): p is string => !!p && !signedUrls[p]);
    if (paths.length === 0) return;
    void Promise.all(
      paths.map(async (path) => {
        const url = await getSignedRecruitingChatFileUrl(path);
        if (url && !cancelled) setSignedUrls((prev) => ({ ...prev, [path]: url }));
      }),
    );
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const sendMessage = () => {
    const t = chatInput.trim();
    if (!t) return;
    const now = Date.now();
    if (now - lastSendAtRef.current < UI_DOUBLE_SUBMIT_DEBOUNCE_MS) return;
    lastSendAtRef.current = now;
    addRecruitingMessage(threadId, fromRole, t);
    setChatInput('');
    setChatInputHeight(36);
  };

  const openUrl = (url: string) => {
    if (!validateUrl(url).ok) return;
    void Linking.openURL(url).catch(() => {});
  };

  const handleFileSelected = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setUploadError(uiCopy.validation.uploadFailed);
        return;
      }
      const rights = await confirmImageRights({
        userId: auth.user.id,
        modelId: null,
        sessionKey: `recruiting-chat:${threadId}`,
      });
      if (!rights.ok) {
        setUploadError(uiCopy.legal.imageRightsConfirmationFailed);
        return;
      }
      const sent = await addRecruitingMessageWithFile(threadId, fromRole, file, file.name);
      if (!sent.ok) {
        setUploadError(
          sent.reason === 'image_rights_not_confirmed'
            ? uiCopy.legal.chatFileRightsMissing
            : uiCopy.validation.uploadFailed,
        );
      }
    } catch (e) {
      console.error('handleFileSelected error:', e);
      setUploadError(uiCopy.validation.uploadFailed);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setShowConsentRow(false);
      setFileRightsConfirmed(false);
      setPendingFile(null);
    }
  };

  const openFileInput = () => {
    if (Platform.OS === 'web' && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  /** Open file picker directly; consent row appears only after a file is selected. */
  const handleAttachPress = () => {
    openFileInput();
  };

  /** When user checks the consent box after selecting a file, start the upload. */
  const handleConsentToggle = () => {
    const next = !fileRightsConfirmed;
    setFileRightsConfirmed(next);
    if (next && pendingFile) {
      void handleFileSelected(pendingFile);
    }
  };

  /** Called when a file is chosen via the picker — shows consent row before uploading. */
  const handleFileInputChange = (file: File) => {
    setPendingFile(file);
    setShowConsentRow(true);
    setFileRightsConfirmed(false);
    setUploadError(null);
  };

  const displayAgencyName = agencyName || initialAgencyName || 'Agency';

  const copyBookingLink = () => {
    if (typeof window === 'undefined' || !threadId) return;
    const url = `${window.location.origin}${window.location.pathname || ''}?booking=${threadId}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url);
    }
  };

  // Whether the chat is rendered as a full inset panel (above tab bar) vs a floating modal card.
  const isInset = presentation === 'insetAboveBottomNav';

  // Android hardware back: treat as close/back
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  // In inset mode, messages expand to fill remaining space (flex:1).
  // In modal mode on native, cap height to avoid overflow.
  const messagesScrollStyle = isInset || Platform.OS === 'web'
    ? [styles.messages, { flex: 1, minHeight: 0 }]
    : [styles.messages, { maxHeight: bookingMessagesMaxHeight }];

  // Resolve title and subtitle for the unified WhatsApp-like header
  const headerTitle = fromRole === 'model'
    ? displayAgencyName
    : (thread ? thread.modelName : 'Chat');
  const headerSubtitle = fromRole === 'model'
    ? (thread ? `As: ${thread.modelName}` : null)
    : (application ? `${application.city || '—'} · ${application.height} cm` : null);

  // Shared inner content (header + optional profile strip + messages + input)
  const chatInner = (
    <View style={styles.chatInnerColumn}>
      {/* ── WhatsApp-like header ── */}
      <View style={styles.header}>
        {/* Back / Close: left side — always present */}
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.backBtn}
        >
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        {/* Center: title + optional subtitle */}
        <View style={styles.headerCenter}>
          {fromRole === 'model' && agencyOrgIdForProfile ? (
            <TouchableOpacity
              onPress={() => setShowAgencyProfile(true)}
              activeOpacity={0.7}
              style={styles.headerTitleBtn}
            >
              {agencyLogoUrl ? (
                <Image source={{ uri: agencyLogoUrl }} style={styles.agencyLogoSmall} resizeMode="contain" />
              ) : (
                <View style={styles.agencyLogoPlaceholderSmall}>
                  <Text style={styles.agencyLogoLetter}>{displayAgencyName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title} numberOfLines={1}>{headerTitle}</Text>
                {headerSubtitle ? <Text style={styles.subtitle} numberOfLines={1}>{headerSubtitle}</Text> : null}
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerTitleBtn}>
              {fromRole === 'agency' && agencyLogoUrl ? (
                <Image source={{ uri: agencyLogoUrl }} style={styles.agencyLogoSmall} resizeMode="contain" />
              ) : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title} numberOfLines={1}>{headerTitle}</Text>
                {headerSubtitle ? <Text style={styles.subtitle} numberOfLines={1}>{headerSubtitle}</Text> : null}
              </View>
            </View>
          )}
        </View>

        {/* Right: secondary actions */}
        <View style={styles.headerRight}>
          {thread?.chatType === 'active_model' && (
            <View style={styles.chatTypeBadge}>
              <Text style={styles.chatTypeBadgeLabel}>Active</Text>
            </View>
          )}
          {fromRole === 'agency' && Platform.OS === 'web' && (
            <TouchableOpacity onPress={copyBookingLink} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.copyLinkLabel}>Share</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {application && (() => {
        const photos = [application.images?.closeUp, application.images?.fullBody, application.images?.profile].filter(Boolean);
        if (!photos.length) return null;
        const isMobileNative = Platform.OS !== 'web';
        return (
          <View style={[styles.profileRow, isMobileNative && styles.profileRowMobile]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {photos.map((uri, idx) => (
                <StorageImage
                  key={idx}
                  uri={uri!}
                  style={isMobileNative ? styles.profileImageMobile : styles.profileImage}
                  resizeMode="contain"
                />
              ))}
            </ScrollView>
          </View>
        );
      })()}
      <ScrollView
        style={messagesScrollStyle}
        contentContainerStyle={[styles.messagesContent, { flexGrow: 1 }]}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((msg) => {
          const isSelf = msg.from === fromRole;
          const resolvedFileUrl = msg.fileUrl ? (signedUrls[msg.fileUrl] ?? null) : null;
          const isImage = !!msg.fileType && msg.fileType.startsWith('image/');
          return (
            <View key={msg.id} style={[styles.bubbleWrapper, isSelf && styles.bubbleWrapperSelf]}>
              {/* Image attachment */}
              {msg.fileUrl && isImage ? (
                resolvedFileUrl ? (
                  <Pressable onPress={() => openUrl(resolvedFileUrl)}>
                    <Image
                      source={{ uri: resolvedFileUrl }}
                      style={styles.attachedImage}
                      resizeMode="contain"
                    />
                  </Pressable>
                ) : (
                  <View style={styles.attachedImagePlaceholder}>
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  </View>
                )
              ) : null}
              {/* Non-image file attachment */}
              {msg.fileUrl && !isImage ? (
                <Pressable
                  style={[styles.fileCard, isSelf && styles.fileCardSelf]}
                  onPress={() => resolvedFileUrl && openUrl(resolvedFileUrl)}
                >
                  <Text style={styles.fileCardIcon}>📎</Text>
                  <Text style={[styles.fileCardLabel, isSelf && styles.fileCardLabelSelf]} numberOfLines={1}>
                    Attachment
                  </Text>
                  <Text style={styles.fileCardOpen}>Open</Text>
                </Pressable>
              ) : null}
              {/* Text content */}
              {msg.text ? (
                (() => {
                  const rc = isSelf ? outgoingSelfBubbleColors : bubbleColorsForSender(msg.from);
                  return (
                    <View
                      style={[
                        styles.bubble,
                        isSelf && styles.bubbleOutgoing,
                        {
                          backgroundColor: rc.bubbleBackground,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: rc.borderColor,
                          alignSelf: isSelf ? 'flex-end' : 'flex-start',
                        },
                      ]}
                    >
                      <Text style={[styles.bubbleText, { color: rc.bubbleText }]}>{msg.text}</Text>
                    </View>
                  );
                })()
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      {uploadError ? <Text style={styles.uploadError}>{uploadError}</Text> : null}
      {Platform.OS === 'web' && showConsentRow ? (
        <TouchableOpacity
          style={styles.rightsRow}
          onPress={handleConsentToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: fileRightsConfirmed }}
        >
          <View style={[styles.rightsBox, fileRightsConfirmed && styles.rightsBoxOn]}>
            {fileRightsConfirmed ? <Text style={styles.rightsCheck}>✓</Text> : null}
          </View>
          <Text style={styles.rightsLabel}>{uiCopy.legal.chatFileRightsCheckbox}</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.inputRow}>
        {Platform.OS === 'web' ? (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileInputChange(file);
            }}
          />
        ) : null}
        <TouchableOpacity
          style={[
            styles.attachBtn,
            (!fromRole || uploading) && { opacity: 0.4 },
          ]}
          onPress={handleAttachPress}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Text style={styles.attachBtnLabel}>📎</Text>
          )}
        </TouchableOpacity>
        <TextInput
          value={chatInput}
          onChangeText={setChatInput}
          placeholder="Message…"
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, { height: Math.max(36, Math.min(120, chatInputHeight)) }]}
          editable={!uploading}
          multiline
          blurOnSubmit={false}
          onContentSizeChange={(e) => setChatInputHeight(e.nativeEvent.contentSize.height)}
        />
        <TouchableOpacity style={[styles.send, uploading && { opacity: 0.5 }]} onPress={sendMessage} disabled={uploading}>
          <Text style={styles.sendLabel}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const orgProfileModal = showAgencyProfile && agencyOrgIdForProfile ? (
    <OrgProfileModal
      visible
      onClose={() => setShowAgencyProfile(false)}
      orgType="agency"
      organizationId={agencyOrgIdForProfile}
      agencyId={applicationAgencyId ?? application?.agencyId ?? null}
      orgName={displayAgencyName}
    />
  ) : null;

  // Wrap chatInner with KAV on native so the composer stays above the keyboard.
  const chatInnerWithKAV = Platform.OS !== 'web' ? (
    <KeyboardAvoidingView
      style={{ flex: 1, minHeight: 0 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {chatInner}
    </KeyboardAvoidingView>
  ) : chatInner;

  // insetAboveBottomNav: fills the full area above the tab bar (true WhatsApp-style fullscreen panel).
  if (isInset) {
    return (
      <View style={[styles.insetShell, { bottom: bottomInset }]}>
        <View style={styles.insetPanel}>
          {chatInnerWithKAV}
        </View>
        {orgProfileModal}
      </View>
    );
  }

  // modal: centered floating card with dim overlay.
  const chatBody = (
    <View style={styles.overlay}>
      <View
        style={[
          styles.card,
          { maxWidth: chatOverlayMaxWidth },
          Platform.OS === 'web' && { flex: 1, minHeight: 0, flexDirection: 'column' as const },
        ]}
      >
        {chatInnerWithKAV}
      </View>
    </View>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {chatBody}
      {orgProfileModal}
    </Modal>
  );
};

const styles = StyleSheet.create({
  insetShell: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: 0,
    zIndex: 900,
  },
  // Fullscreen panel inside insetShell — fills the entire available space.
  insetPanel: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    overflow: 'hidden',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.sm,
  },
  card: {
    width: '100%',
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    overflow: 'hidden',
  },
  chatInnerColumn: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  // WhatsApp-like unified header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexShrink: 0,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
    minWidth: 48,
    maxWidth: 90,
  },
  backArrow: {
    ...typography.label,
    fontSize: 18,
    color: colors.textPrimary,
  },
  backText: {
    ...typography.label,
    fontSize: 13,
    color: colors.accent,
    fontWeight: '600',
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
  },
  headerTitleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    minWidth: 0,
  },
  headerRight: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  chatTypeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.buttonOptionGreen,
  },
  chatTypeBadgeLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.surface,
  },
  agencyLogoSmall: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: colors.border,
    flexShrink: 0,
  },
  agencyLogoPlaceholderSmall: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  agencyLogoLetter: {
    ...typography.heading,
    fontSize: 14,
    color: colors.surface,
  },
  title: {
    ...typography.heading,
    fontSize: 15,
    color: colors.textPrimary,
  },
  messagesContent: {
    flexGrow: 1,
    paddingBottom: spacing.sm,
  },
  copyLinkLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.buttonOptionGreen,
  },
  profileRow: {
    marginBottom: spacing.sm,
  },
  profileRowMobile: {
    marginBottom: spacing.xs,
  },
  profileImage: {
    width: 72,
    height: 90,
    borderRadius: 8,
    backgroundColor: colors.border,
    marginRight: spacing.sm,
  },
  profileImageMobile: {
    width: 56,
    height: 64,
    borderRadius: 6,
    backgroundColor: colors.border,
    marginRight: spacing.xs,
  },
  messages: {
    marginBottom: spacing.sm,
  },
  bubble: {
    alignSelf: 'flex-start',
    maxWidth: CHAT_BUBBLE_MAX_WIDTH,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    marginBottom: spacing.xs,
  },
  /** Outgoing text bubble: slight right gutter vs full flush-right. */
  bubbleOutgoing: {
    maxWidth: CHAT_BUBBLE_MAX_WIDTH,
    marginLeft: '12%',
    marginRight: spacing.sm,
  },
  bubbleSelf: {
    alignSelf: 'flex-end',
    backgroundColor: colors.textPrimary,
  },
  bubbleOther: {
    backgroundColor: colors.border,
  },
  bubbleText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
  },
  bubbleTextSelf: {
    color: colors.surface,
  },
  bubbleWrapper: {
    alignSelf: 'flex-start',
    maxWidth: CHAT_BUBBLE_MAX_WIDTH,
    marginBottom: spacing.xs,
  },
  bubbleWrapperSelf: {
    alignSelf: 'flex-end',
  },
  attachedImage: {
    width: 200,
    height: 150,
    borderRadius: 10,
    backgroundColor: colors.border,
    marginBottom: 2,
  },
  attachedImagePlaceholder: {
    width: 200,
    height: 150,
    borderRadius: 10,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    marginBottom: 2,
  },
  fileCardSelf: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  fileCardIcon: {
    fontSize: 14,
  },
  fileCardLabel: {
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
    flex: 1,
  },
  fileCardLabelSelf: {
    color: colors.surface,
  },
  fileCardOpen: {
    ...typography.label,
    fontSize: 10,
    color: colors.accentGreen,
  },
  rightsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    flexShrink: 0,
  },
  rightsBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  rightsBoxOn: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  rightsCheck: { color: colors.surface, fontSize: 11, fontWeight: '700' },
  rightsLabel: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 16,
  },
  uploadError: {
    ...typography.body,
    fontSize: 11,
    color: '#e53925',
    marginBottom: spacing.xs,
    marginHorizontal: spacing.xs,
    flexShrink: 0,
  },
  attachBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  attachBtnLabel: {
    fontSize: 16,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
    minHeight: 36,
    maxHeight: 120,
  },
  send: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.textPrimary,
  },
  sendLabel: {
    ...typography.label,
    color: colors.surface,
  },
});

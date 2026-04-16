import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  type ViewStyle,
  Modal,
  Pressable,
  Image,
  Platform,
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  KeyboardAvoidingView,
} from 'react-native';
import { StorageImage } from './StorageImage';
import ChatLayoutFix from './ChatLayoutFix';
import { colors, spacing, typography } from '../theme/theme';
import { bubbleColorsForSender, outgoingSelfBubbleColors } from '../theme/roleColors';
import {
  CHAT_BUBBLE_MAX_WIDTH,
  getOrgMessengerMessageColumnStyle,
  getOrgMessengerSenderLineExtraStyle,
} from './orgMessengerMessageLayout';
import { uiCopy } from '../constants/uiCopy';
import {
  getMessagesWithSenderInfo,
  sendMessage as sendMessengerMessage,
  subscribeToConversation,
  uploadChatFile,
  buildMessengerUploadSessionKey,
  getSignedChatFileUrl,
  markAllAsRead,
  type MessagePayloadType,
  type MessageWithSender,
} from '../services/messengerSupabase';
import { supabase } from '../../lib/supabase';
import { confirmImageRights } from '../services/gdprComplianceSupabase';
import { getModelByIdFromSupabase } from '../services/modelsSupabase';
import { normalizeDocumentspicturesModelImageRef } from '../utils/normalizeModelPortfolioUrl';
import { formatB2bClientHeaderPrimary } from '../utils/b2bMessengerHeaderTitle';
import { openLinkWithFeedback } from '../utils/openLinkWithFeedback';
import { buildGuestUrl, type GuestLink } from '../services/guestLinksSupabase';
import {
  bookingStatusLabel,
  updateBookingEventStatus,
  type BookingEventStatus,
} from '../services/bookingEventsSupabase';
import {
  validateText,
  validateUrl,
  validateFile,
  checkMagicBytes,
  extractSafeUrls,
  messageLimiter,
  uploadLimiter,
  CHAT_ALLOWED_MIME_TYPES,
  normalizeInput,
  MESSAGE_MAX_LENGTH,
} from '../../lib/validation';

/** Structured context displayed in the thread sub-header. */
export type ThreadContext = {
  type: 'Option' | 'Casting' | 'Booking' | string;
  modelName?: string;
  date?: string;
  clientFlagLabel?: string;
  clientFlagColor?: string;
  assignedMemberName?: string;
  /** Optional second line below thread context (e.g. representation ended notice). */
  footnote?: string;
};

/** Organization-scoped B2B thread (client org ↔ agency org). Not a user-to-user or "connection" chat. */
export type OrgMessengerInlineProps = {
  conversationId: string;
  headerTitle: string;
  viewerUserId: string | null;
  /** Structured thread context shown as sub-header: "Option • Model X • 12 June". */
  threadContext?: ThreadContext | null;
  /** When set, show Share package / model actions (agency workspace). */
  agencyId?: string | null;
  guestLinks?: GuestLink[];
  modelsForShare?: { id: string; name: string }[];
  containerStyle?: ViewStyle;
  /** Called when the user taps a booking card. Receives the booking metadata from the message. */
  onBookingCardPress?: (metadata: Record<string, unknown>) => void;
  /** Optional quick jump from booking card to the related option request thread. */
  onOpenRelatedRequest?: (optionRequestId: string) => void;
  /**
   * Called when the user taps "Request from this package" on a package card.
   * Receives the full package metadata (package_id, guest_link, preview_model_ids, etc.).
   * If not provided, the button is hidden.
   */
  onPackagePress?: (metadata: Record<string, unknown>) => void;
  /**
   * Legacy: previously gated flex layout on web. Web always uses ChatLayoutFix now;
   * prop kept for call-site compatibility (ignored).
   */
  useFlexMessengerScroll?: boolean;
  /**
   * Role of the viewer. Used to determine which booking status-change actions to show.
   * 'agency' can accept (pending→agency_accepted) and cancel.
   * 'model' can confirm (agency_accepted→model_confirmed).
   * 'client' is read-only (status displayed only).
   */
  viewerRole?: 'agency' | 'client' | 'model';
  /**
   * Called after a booking status has been successfully updated so the parent
   * can refresh calendar / request lists.
   */
  onBookingStatusUpdated?: (bookingEventId: string, newStatus: BookingEventStatus) => void;
  /**
   * When provided, the headerTitle becomes a tappable link that opens the
   * counterparty's organization profile (Phase 2B).
   */
  onOrgPress?: () => void;
  /**
   * When using flex chat layout (native / web split), padding below the composer for the tab bar.
   * Set to 0 when the messenger sits in a shell without a bottom tab (e.g. guest chat).
   */
  composerBottomInsetOverride?: number;
  /**
   * When provided, a WhatsApp-like back button is prepended to the messenger header.
   * Use on mobile when a thread is selected within a list (e.g. B2B chats panel).
   * Non-breaking: omitting this prop keeps the existing header unchanged.
   */
  onBack?: () => void;
  backLabel?: string;
  /**
   * B2B org chat: shapes the main header line — client sees "Model — Agency" when a booking
   * model name is available from loaded messages; agency sees client org title; model sees agency title.
   */
  b2bViewerRole?: 'client' | 'agency' | 'model';
};

function payloadType(m: MessageWithSender): MessagePayloadType {
  const t = (m as { message_type?: string }).message_type;
  if (t === 'link' || t === 'package' || t === 'model' || t === 'booking') return t;
  return 'text';
}

function metaString(m: MessageWithSender, key: string): string | undefined {
  const raw = (m as { metadata?: Record<string, unknown> }).metadata?.[key];
  return typeof raw === 'string' ? raw : undefined;
}

function metaStringArray(m: MessageWithSender, key: string): string[] {
  const raw = (m as { metadata?: Record<string, unknown> }).metadata?.[key];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  return [];
}

export const OrgMessengerInline: React.FC<OrgMessengerInlineProps> = ({
  conversationId,
  headerTitle,
  viewerUserId,
  threadContext,
  agencyId,
  guestLinks = [],
  modelsForShare = [],
  containerStyle,
  onBookingCardPress,
  onOpenRelatedRequest,
  onPackagePress,
  useFlexMessengerScroll: _legacyUseFlexMessengerScroll = false,
  viewerRole,
  onBookingStatusUpdated,
  onOrgPress,
  composerBottomInsetOverride,
  onBack,
  backLabel,
  b2bViewerRole,
}) => {
  const [msgs, setMsgs] = useState<MessageWithSender[]>([]);
  const [input, setInput] = useState('');
  const [inputHeight, setInputHeight] = useState(36);
  const [shareOpen, setShareOpen] = useState<'package' | 'model' | null>(null);
  const [bookingModelNames, setBookingModelNames] = useState<Record<string, string>>({});
  /** Tracks model IDs whose name fetch is already in-flight or resolved, preventing duplicate requests. */
  const fetchedModelIds = useRef<Set<string>>(new Set());
  /** model_id → first portfolio_images URL, for package card previews */
  const [packageModelPhotos, setPackageModelPhotos] = useState<Record<string, string>>({});
  const fetchedPackagePhotoIds = useRef<Set<string>>(new Set());
  /** storage path → signed URL cache for file attachments */
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  /** Web-only: checked by user after selecting a file, before upload starts. */
  const [fileRightsConfirmed, setFileRightsConfirmed] = useState(false);
  /** Web-only: consent row is only shown after a file has been selected. */
  const [showConsentRow, setShowConsentRow] = useState(false);
  /** Web-only: file awaiting consent confirmation before upload. */
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [bookingActionLoading, setBookingActionLoading] = useState<string | null>(null);

  const handleBookingAction = async (bookingEventId: string, newStatus: BookingEventStatus) => {
    if (!bookingEventId || bookingActionLoading) return;
    setBookingActionLoading(bookingEventId + ':' + newStatus);
    try {
      const result = await updateBookingEventStatus(bookingEventId, newStatus);
      if (result.ok) {
        onBookingStatusUpdated?.(bookingEventId, newStatus);
        reload();
      } else {
        setSendError(result.message ?? 'Could not update booking status.');
      }
    } catch {
      setSendError('Could not update booking status.');
    } finally {
      setBookingActionLoading(null);
    }
  };
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = () => void getMessagesWithSenderInfo(conversationId).then(setMsgs);

  useEffect(() => {
    reload();
    if (viewerUserId) void markAllAsRead(conversationId, viewerUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, viewerUserId]);

  useEffect(() => {
    setFileRightsConfirmed(false);
    setShowConsentRow(false);
    setPendingFile(null);
  }, [conversationId]);

  useEffect(() => {
    const unsub = subscribeToConversation(conversationId, () => reload());
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Reconnect: when the app returns to foreground after being backgrounded,
  // force a reload and re-subscribe so no messages are missed during sleep.
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        reload();
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Resolve booking model names for booking cards.
  // Uses fetchedModelIds ref to prevent duplicate in-flight requests when a model
  // has no name (row?.name undefined), which would otherwise re-trigger on every msgs update.
  useEffect(() => {
    const bookingModelIds = Array.from(
      new Set(
        msgs
          .filter((m) => (m as { message_type?: string }).message_type === 'booking')
          .map((m) => (m as { metadata?: Record<string, unknown> }).metadata?.['model_id'])
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0),
      ),
    );
    const missing = bookingModelIds.filter((id) => !fetchedModelIds.current.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => fetchedModelIds.current.add(id));

    void Promise.all(
      missing.map(async (modelId) => {
        const row = await getModelByIdFromSupabase(modelId);
        if (!row?.name) return;
        setBookingModelNames((prev) => ({ ...prev, [modelId]: row.name }));
      }),
    );
  }, [msgs]);

  const latestBookingModelName = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if ((m as { message_type?: string }).message_type !== 'booking') continue;
      const mid = (m as { metadata?: Record<string, unknown> }).metadata?.['model_id'];
      if (typeof mid !== 'string' || !mid.trim()) continue;
      const name = bookingModelNames[mid];
      if (name?.trim()) return name.trim();
    }
    return null;
  }, [msgs, bookingModelNames]);

  const displayHeaderTitle = useMemo(() => {
    const fb = uiCopy.b2bChat.conversationFallback;
    const base = headerTitle?.trim() ?? '';
    if (b2bViewerRole === 'client') {
      return formatB2bClientHeaderPrimary(base || fb, latestBookingModelName);
    }
    if (!base) return fb;
    return base;
  }, [headerTitle, b2bViewerRole, latestBookingModelName]);

  // Resolve model preview photos for package cards.
  // Uses fetchedPackagePhotoIds ref to avoid refetching when a model has no photo.
  useEffect(() => {
    const previewIds = Array.from(
      new Set(
        msgs
          .filter((m) => (m as { message_type?: string }).message_type === 'package')
          .flatMap((m) => metaStringArray(m, 'preview_model_ids')),
      ),
    );
    const missing = previewIds.filter((id) => !fetchedPackagePhotoIds.current.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => fetchedPackagePhotoIds.current.add(id));

    void Promise.all(
      missing.map(async (modelId) => {
        try {
          const row = await getModelByIdFromSupabase(modelId);
          const rawPhoto = row?.portfolio_images?.[0];
          if (!rawPhoto) return;
          const photo = normalizeDocumentspicturesModelImageRef(rawPhoto, modelId);
          setPackageModelPhotos((prev) => ({ ...prev, [modelId]: photo }));
        } catch (e) {
          console.error('packageModelPhotos lookup error:', e);
        }
      }),
    );
  }, [msgs]);

  // Resolve signed URLs for all file attachments in the current message list.
  // signedUrls is captured via the filter so it must be in the dependency array.
  // Using a ref snapshot avoids the stale-closure issue while keeping the exhaustive-deps rule satisfied.
  const signedUrlsRef = useRef(signedUrls);
  signedUrlsRef.current = signedUrls;

  useEffect(() => {
    const paths = msgs
      .map((m) => (m as { file_url?: string | null }).file_url)
      .filter((p): p is string => !!p && !signedUrlsRef.current[p]);
    if (paths.length === 0) return;
    void Promise.all(
      paths.map(async (path) => {
        const url = await getSignedChatFileUrl(path);
        if (url) setSignedUrls((prev) => ({ ...prev, [path]: url }));
      }),
    );
  }, [msgs]);

  const sendChat = async () => {
    const text = normalizeInput(input);
    if (!text || !viewerUserId || sending || uploading) return;
    setSendError(null);

    // Rate limit check
    const rateCheck = messageLimiter.check(viewerUserId);
    if (!rateCheck.ok) {
      setSendError(uiCopy.validation.rateLimitMessages);
      return;
    }

    // Text length + content validation
    const textCheck = validateText(text, { maxLength: MESSAGE_MAX_LENGTH, allowEmpty: false });
    if (!textCheck.ok) {
      setSendError(uiCopy.validation.messageTooLong);
      return;
    }

    // Extract URLs in the text and validate each one
    const allRawUrls = text.match(/https?:\/\/[^\s]+/gi) ?? [];
    const safeUrls = extractSafeUrls(text);
    if (allRawUrls.length > safeUrls.length) {
      setSendError(uiCopy.validation.unsafeUrl);
      return;
    }

    setSending(true);
    try {
      // Auto-promote plain text containing a URL to a 'link' message.
      const firstUrl = safeUrls[0] ?? null;
      if (firstUrl) {
        const urlCheck = validateUrl(firstUrl);
        if (!urlCheck.ok) {
          setSendError(uiCopy.validation.unsafeUrl);
          return;
        }
        await sendMessengerMessage(conversationId, viewerUserId, text, undefined, undefined, {
          messageType: 'link',
          metadata: { url: firstUrl },
        });
      } else {
        await sendMessengerMessage(conversationId, viewerUserId, text);
      }
      setInput('');
      setInputHeight(36);
      reload();
    } catch (e) {
      console.error('sendChat error:', e);
      setSendError(uiCopy.messenger.sendFailed);
    } finally {
      setSending(false);
    }
  };

  const handleFileSelected = async (file: File) => {
    if (!viewerUserId) return;
    setUploading(true);
    setUploadError(null);
    try {
      if (Platform.OS === 'web') {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) {
          setUploadError(uiCopy.validation.uploadFailed);
          return;
        }
        const rights = await confirmImageRights({
          userId: auth.user.id,
          modelId: null,
          sessionKey: buildMessengerUploadSessionKey(conversationId),
        });
        if (!rights.ok) {
          setUploadError(uiCopy.legal.imageRightsConfirmationFailed);
          return;
        }
      }

      // Rate limit check
      const rateCheck = uploadLimiter.check(viewerUserId);
      if (!rateCheck.ok) {
        setUploadError(uiCopy.validation.rateLimitUploads);
        return;
      }

      // MIME type + size validation
      const mimeCheck = validateFile(file, CHAT_ALLOWED_MIME_TYPES);
      if (!mimeCheck.ok) {
        setUploadError(uiCopy.validation.fileTypeNotAllowed);
        return;
      }

      // Magic byte check — prevents renamed executables
      const magicCheck = await checkMagicBytes(file);
      if (!magicCheck.ok) {
        setUploadError(uiCopy.validation.fileContentMismatch);
        return;
      }

      const path = await uploadChatFile(conversationId, file, file.name);
      if (!path) {
        setUploadError(uiCopy.validation.uploadFailed);
        return;
      }
      await sendMessengerMessage(
        conversationId,
        viewerUserId,
        '',
        path,
        file.type || 'application/octet-stream',
      );
      reload();
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
  const handleAttachPress = async () => {
    if (Platform.OS === 'web') {
      openFileInput();
    } else {
      const { pickChatAttachmentNative } = await import('../utils/pickChatAttachmentNative');
      const picked = await pickChatAttachmentNative();
      if (picked) handleFileInputChange(picked.file as File);
    }
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

  const sendRich = async (
    type: MessagePayloadType,
    text: string,
    metadata?: Record<string, unknown>,
  ) => {
    if (!viewerUserId || sending) return;

    // Apply the same rate limit guard as sendChat so rich and plain paths are equally hardened.
    const rateCheck = messageLimiter.check(viewerUserId);
    if (!rateCheck.ok) {
      setSendError(uiCopy.validation.rateLimitMessages);
      return;
    }

    setSending(true);
    try {
      await sendMessengerMessage(conversationId, viewerUserId, text, undefined, undefined, {
        messageType: type,
        metadata: metadata ?? null,
      });
      setShareOpen(null);
      reload();
    } catch (e) {
      console.error('sendRich error:', e);
      setSendError(uiCopy.messenger.sendFailed);
    } finally {
      setSending(false);
    }
  };

  const openUrl = (url: string) => {
    // Only open validated https:// URLs
    const check = validateUrl(url);
    if (!check.ok) {
      console.warn('openUrl: blocked unsafe URL', url);
      return;
    }
    openLinkWithFeedback(url);
  };

  const showShare = !!agencyId && (guestLinks.length > 0 || modelsForShare.length > 0);
  /** Mobile B2B thread (back button + agency share actions): keep header height close to client chat. */
  const compactAgencyShareHeader = !!onBack && showShare;

  const threadContextLabel = threadContext
    ? [threadContext.type, threadContext.modelName, threadContext.date].filter(Boolean).join(' • ')
    : null;
  const threadContextAssignment = threadContext?.clientFlagLabel
    ? `${threadContext.clientFlagLabel}${threadContext.assignedMemberName ? ` · ${threadContext.assignedMemberName}` : ''}`
    : null;

  const messengerHeader = (
    <>
      {onOrgPress ? (
        <TouchableOpacity onPress={onOrgPress} style={styles.chatPanelTitleBtn}>
          <Text
            style={[
              styles.chatPanelTitle,
              styles.chatPanelTitleClickable,
              compactAgencyShareHeader && styles.chatPanelTitleCompact,
            ]}
          >
            {displayHeaderTitle}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text
          style={[styles.chatPanelTitle, compactAgencyShareHeader && styles.chatPanelTitleCompact]}
        >
          {displayHeaderTitle}
        </Text>
      )}
      {threadContextLabel ? (
        <Text
          style={[
            styles.threadContextSubheader,
            compactAgencyShareHeader && styles.threadContextSubheaderCompact,
          ]}
        >
          {threadContextLabel}
        </Text>
      ) : null}
      {threadContextAssignment ? (
        <View
          style={[
            styles.assignmentPill,
            { borderColor: threadContext?.clientFlagColor || colors.border },
          ]}
        >
          <Text style={styles.assignmentPillLabel}>{threadContextAssignment}</Text>
        </View>
      ) : null}
      {threadContext?.footnote ? (
        <Text
          style={[
            styles.threadContextSubheader,
            compactAgencyShareHeader && styles.threadContextSubheaderCompact,
            { fontSize: 11, marginTop: 2 },
          ]}
        >
          {threadContext.footnote}
        </Text>
      ) : null}

      {showShare ? (
        <View style={[styles.shareRow, compactAgencyShareHeader && styles.shareRowCompact]}>
          {guestLinks.length > 0 ? (
            <TouchableOpacity
              style={[styles.shareBtn, compactAgencyShareHeader && styles.shareBtnCompact]}
              onPress={() => setShareOpen('package')}
            >
              <Text
                style={[
                  styles.shareBtnLabel,
                  compactAgencyShareHeader && styles.shareBtnLabelCompact,
                ]}
              >
                {uiCopy.b2bChat.sharePackage}
              </Text>
            </TouchableOpacity>
          ) : null}
          {modelsForShare.length > 0 ? (
            <TouchableOpacity
              style={[styles.shareBtn, compactAgencyShareHeader && styles.shareBtnCompact]}
              onPress={() => setShareOpen('model')}
            >
              <Text
                style={[
                  styles.shareBtnLabel,
                  compactAgencyShareHeader && styles.shareBtnLabelCompact,
                ]}
              >
                {uiCopy.b2bChat.shareModel}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </>
  );

  const loadOlderMessages = async () => {
    if (msgs.length === 0) return;
    const oldestMsg = msgs[0];
    const older = await getMessagesWithSenderInfo(conversationId, {
      beforeId: oldestMsg.id,
      limit: 50,
    });
    if (older.length > 0) {
      const existingIds = new Set(msgs.map((m) => m.id));
      const newMsgs = older.filter((m) => !existingIds.has(m.id));
      if (newMsgs.length > 0) setMsgs((prev) => [...newMsgs, ...prev]);
    }
  };

  const incomingOrgTextBubble = bubbleColorsForSender('client');

  const messageNodes = msgs.map((m) => {
    const pt = payloadType(m);
    const rawFileUrl = (m as { file_url?: string | null }).file_url ?? null;
    const fileType = (m as { file_type?: string | null }).file_type ?? null;
    const resolvedFileUrl = rawFileUrl ? (signedUrls[rawFileUrl] ?? null) : null;
    const isImage = !!fileType && fileType.startsWith('image/');
    const isOwn = Boolean(viewerUserId && m.sender_id === viewerUserId);
    return (
      <View key={m.id} style={styles.msgBlock}>
        <View style={getOrgMessengerMessageColumnStyle(isOwn)}>
          <Text style={[styles.senderLine, getOrgMessengerSenderLineExtraStyle(isOwn)]}>
            {m.senderLabel}
          </Text>
          {/* File / image attachment */}
          {rawFileUrl ? (
            <View
              style={[
                styles.attachmentRow,
                isOwn ? styles.attachmentRowOutgoing : styles.attachmentRowIncoming,
              ]}
            >
              {isImage ? (
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
              ) : (
                <Pressable
                  style={styles.fileCard}
                  onPress={() => resolvedFileUrl && openUrl(resolvedFileUrl)}
                >
                  <Text style={styles.fileCardIcon}>📎</Text>
                  <Text style={styles.fileCardLabel} numberOfLines={1}>
                    {uiCopy.b2bChat.fileAttachment}
                  </Text>
                  <Text style={styles.fileCardOpen}>{uiCopy.b2bChat.openFile}</Text>
                </Pressable>
              )}
            </View>
          ) : null}
          {/* Text content */}
          {pt === 'text' && m.text ? (
            <View
              style={[
                styles.bubbleRow,
                isOwn ? styles.bubbleRowOutgoing : styles.bubbleRowIncoming,
              ]}
            >
              <View
                style={[
                  styles.msgBubble,
                  isOwn
                    ? {
                        backgroundColor: outgoingSelfBubbleColors.bubbleBackground,
                        borderColor: outgoingSelfBubbleColors.borderColor,
                      }
                    : {
                        backgroundColor: incomingOrgTextBubble.bubbleBackground,
                        borderColor: incomingOrgTextBubble.borderColor,
                      },
                ]}
              >
                <Text
                  style={[
                    styles.chatBubbleTextInBubble,
                    {
                      color: isOwn
                        ? outgoingSelfBubbleColors.bubbleText
                        : incomingOrgTextBubble.bubbleText,
                    },
                  ]}
                >
                  {m.text}
                </Text>
              </View>
            </View>
          ) : null}
          {pt === 'link' ? (
            <View
              style={[
                styles.bubbleRow,
                isOwn ? styles.bubbleRowOutgoing : styles.bubbleRowIncoming,
              ]}
            >
              <View
                style={[
                  styles.msgBubble,
                  isOwn
                    ? {
                        backgroundColor: outgoingSelfBubbleColors.bubbleBackground,
                        borderColor: outgoingSelfBubbleColors.borderColor,
                      }
                    : {
                        backgroundColor: incomingOrgTextBubble.bubbleBackground,
                        borderColor: incomingOrgTextBubble.borderColor,
                      },
                ]}
              >
                <Pressable onPress={() => metaString(m, 'url') && openUrl(metaString(m, 'url')!)}>
                  <Text
                    style={[
                      styles.linkTextInBubble,
                      { color: isOwn ? outgoingSelfBubbleColors.bubbleText : colors.accentGreen },
                    ]}
                  >
                    {m.text || metaString(m, 'url') || 'Link'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {pt === 'package'
            ? (() => {
                const meta = (m as { metadata?: Record<string, unknown> }).metadata ?? {};
                const previewIds = metaStringArray(m, 'preview_model_ids');
                const packageLabel = metaString(m, 'package_label');
                const packageName = metaString(m, 'package_name');
                const guestLink = metaString(m, 'guest_link');
                const isInAppAccess = !!onPackagePress;
                return (
                  <View style={styles.card}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.cardTitle}>{uiCopy.b2bChat.sharedPackage}</Text>
                      <View
                        style={[
                          styles.accessBadge,
                          isInAppAccess ? styles.accessBadgeFull : styles.accessBadgeGuest,
                        ]}
                      >
                        <Text
                          style={[
                            styles.accessBadgeLabel,
                            isInAppAccess
                              ? styles.accessBadgeLabelFull
                              : styles.accessBadgeLabelGuest,
                          ]}
                        >
                          {isInAppAccess
                            ? uiCopy.b2bChat.packageBadgeFullAccess
                            : uiCopy.b2bChat.packageBadgeGuestAccess}
                        </Text>
                      </View>
                    </View>
                    {packageName ? <Text style={styles.packageLabel}>{packageName}</Text> : null}
                    {packageLabel ? (
                      <Text style={packageName ? styles.chatSubText : styles.packageLabel}>
                        {packageLabel} {uiCopy.b2bChat.packagePreviewLabel}
                      </Text>
                    ) : !packageName ? (
                      <Text style={styles.chatBubbleText} numberOfLines={2}>
                        {m.text ?? ''}
                      </Text>
                    ) : null}
                    {previewIds.length > 0 ? (
                      <View style={styles.avatarRow}>
                        {previewIds.slice(0, 4).map((modelId) =>
                          packageModelPhotos[modelId] ? (
                            <StorageImage
                              key={modelId}
                              uri={packageModelPhotos[modelId]}
                              style={styles.avatar}
                              resizeMode="cover"
                            />
                          ) : (
                            <View key={modelId} style={[styles.avatar, styles.avatarPlaceholder]}>
                              <Text style={styles.avatarPlaceholderText}>?</Text>
                            </View>
                          ),
                        )}
                      </View>
                    ) : null}
                    <View style={styles.cardActions}>
                      {onPackagePress ? (
                        <TouchableOpacity
                          style={styles.cardBtn}
                          onPress={() => onPackagePress(meta)}
                        >
                          <Text style={styles.cardBtnLabel}>{uiCopy.b2bChat.openPackage}</Text>
                        </TouchableOpacity>
                      ) : guestLink ? (
                        <TouchableOpacity style={styles.cardBtn} onPress={() => openUrl(guestLink)}>
                          <Text style={styles.cardBtnLabel}>{uiCopy.b2bChat.openPackage}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                );
              })()
            : null}
          {pt === 'model' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{uiCopy.b2bChat.sharedModel}</Text>
              <Text style={styles.chatBubbleText}>{m.text ?? ''}</Text>
              {metaString(m, 'model_id') ? (
                <Text style={styles.metaHint}>
                  {uiCopy.b2bChat.modelIdLabel}: {metaString(m, 'model_id')}
                </Text>
              ) : null}
            </View>
          ) : null}
          {pt === 'booking' ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                const meta = (m as { metadata?: Record<string, unknown> }).metadata ?? {};
                onBookingCardPress?.(meta);
              }}
            >
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {metaString(m, 'request_type') === 'casting'
                    ? uiCopy.b2bChat.castingCardTitle
                    : metaString(m, 'request_type') === 'option'
                      ? uiCopy.b2bChat.optionCardTitle
                      : uiCopy.b2bChat.bookingCardTitle}
                </Text>
                <Text style={styles.chatBubbleText} numberOfLines={2}>
                  {uiCopy.b2bChat.bookingModelLabel}:{' '}
                  {(() => {
                    const mid = metaString(m, 'model_id');
                    if (!mid) return '—';
                    return bookingModelNames[mid] ?? mid;
                  })()}
                </Text>
                <Text style={styles.metaHint}>
                  {uiCopy.b2bChat.bookingDateLabel}: {metaString(m, 'date') ?? '—'}
                </Text>
                {(() => {
                  const rawStatus = metaString(m, 'status') ?? 'pending';
                  const bookingId =
                    metaString(m, 'booking_event_id') ?? metaString(m, 'booking_id');
                  const relatedOptionRequestId = metaString(m, 'option_request_id');
                  const isDeleted = rawStatus === 'deleted';
                  const isRejected = rawStatus === 'rejected';
                  const isTerminal = isDeleted || isRejected;
                  const label = isDeleted
                    ? 'Removed'
                    : isRejected
                      ? 'Declined'
                      : bookingStatusLabel(rawStatus as BookingEventStatus);
                  const isCancelled = rawStatus === 'cancelled' || isTerminal;
                  const isConfirmed = rawStatus === 'model_confirmed' || rawStatus === 'completed';
                  const isActionLoading = (key: string) =>
                    bookingActionLoading === bookingId + ':' + key;

                  return (
                    <>
                      <View
                        style={[
                          styles.statusBadge,
                          isCancelled && styles.statusBadgeCancelled,
                          isConfirmed && styles.statusBadgeConfirmed,
                        ]}
                      >
                        <Text style={styles.statusBadgeLabel}>{label}</Text>
                      </View>

                      {/* Booking status action buttons — only when a booking_event_id is available */}
                      {bookingId && !isCancelled && !isConfirmed && (
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                          {viewerRole === 'agency' && rawStatus === 'pending' && (
                            <TouchableOpacity
                              onPress={(e) => {
                                e.stopPropagation?.();
                                void handleBookingAction(bookingId, 'agency_accepted');
                              }}
                              disabled={!!bookingActionLoading}
                              style={[styles.actionBtn, styles.actionBtnConfirm]}
                            >
                              {isActionLoading('agency_accepted') ? (
                                <ActivityIndicator size="small" color={colors.surface} />
                              ) : (
                                <Text style={styles.actionBtnLabel}>Accept</Text>
                              )}
                            </TouchableOpacity>
                          )}
                          {viewerRole === 'model' && rawStatus === 'agency_accepted' && (
                            <TouchableOpacity
                              onPress={(e) => {
                                e.stopPropagation?.();
                                void handleBookingAction(bookingId, 'model_confirmed');
                              }}
                              disabled={!!bookingActionLoading}
                              style={[styles.actionBtn, styles.actionBtnConfirm]}
                            >
                              {isActionLoading('model_confirmed') ? (
                                <ActivityIndicator size="small" color={colors.surface} />
                              ) : (
                                <Text style={styles.actionBtnLabel}>Confirm</Text>
                              )}
                            </TouchableOpacity>
                          )}
                          {(viewerRole === 'agency' || viewerRole === 'client') && (
                            <TouchableOpacity
                              onPress={(e) => {
                                e.stopPropagation?.();
                                void handleBookingAction(bookingId, 'cancelled');
                              }}
                              disabled={!!bookingActionLoading}
                              style={[styles.actionBtn, styles.actionBtnCancel]}
                            >
                              {isActionLoading('cancelled') ? (
                                <ActivityIndicator size="small" color={colors.textPrimary} />
                              ) : (
                                <Text
                                  style={[styles.actionBtnLabel, { color: colors.textPrimary }]}
                                >
                                  Cancel
                                </Text>
                              )}
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                      {onOpenRelatedRequest && relatedOptionRequestId && !isTerminal && (
                        <View style={{ marginTop: 8 }}>
                          <TouchableOpacity
                            onPress={(e) => {
                              e.stopPropagation?.();
                              onOpenRelatedRequest(relatedOptionRequestId);
                            }}
                            style={styles.cardBtn}
                          >
                            <Text style={styles.cardBtnLabel}>
                              {uiCopy.b2bChat.openRelatedRequest}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </>
                  );
                })()}
              </View>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  });

  const messengerComposer = (
    <>
      {sendError ? <Text style={styles.uploadError}>{sendError}</Text> : null}
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
      <View style={styles.chatPanelInputRow}>
        {/* Hidden file input for web */}
        {Platform.OS === 'web' ? (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileInputChange(file);
            }}
          />
        ) : null}
        <TouchableOpacity
          style={[styles.attachBtn, (!viewerUserId || uploading) && { opacity: 0.4 }]}
          onPress={handleAttachPress}
          disabled={!viewerUserId || uploading}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Text style={styles.attachBtnLabel}>📎</Text>
          )}
        </TouchableOpacity>
        <TextInput
          value={input}
          onChangeText={(v) => {
            setInput(v);
            if (sendError) setSendError(null);
          }}
          placeholder={uiCopy.b2bChat.messagePlaceholder}
          placeholderTextColor={colors.textSecondary}
          style={[styles.chatPanelInput, { height: Math.max(36, Math.min(120, inputHeight)) }]}
          editable={!!viewerUserId && !uploading && !sending}
          multiline
          blurOnSubmit={false}
          onContentSizeChange={(e) => setInputHeight(e.nativeEvent.contentSize.height)}
        />
        <TouchableOpacity
          style={[
            styles.chatPanelSend,
            (!viewerUserId || uploading || sending) && { opacity: 0.5 },
          ]}
          onPress={sendChat}
          disabled={!viewerUserId || uploading || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.chatPanelSendLabel}>{uiCopy.b2bChat.send}</Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );

  const Wrapper = Platform.OS === 'web' ? View : KeyboardAvoidingView;
  const wrapperExtra = Platform.OS === 'ios' ? { behavior: 'padding' as const } : {};

  return (
    <Wrapper
      style={[
        styles.chatPanel,
        { flex: 1, minHeight: 0, flexDirection: 'column' as const },
        containerStyle,
      ]}
      {...wrapperExtra}
    >
      <ChatLayoutFix
        header={messengerHeader}
        messageList={
          <>
            {msgs.length >= 50 && (
              <TouchableOpacity
                onPress={() => void loadOlderMessages()}
                style={{ alignSelf: 'center', paddingVertical: spacing.xs }}
              >
                <Text style={{ color: colors.accentBrown, fontSize: 13 }}>
                  {uiCopy.b2bChat.loadOlderMessages}
                </Text>
              </TouchableOpacity>
            )}
            {messageNodes}
          </>
        }
        composer={messengerComposer}
        edgePadding={0}
        bottomTabInset={composerBottomInsetOverride}
        onBack={onBack}
        backLabel={backLabel}
      />

      <Modal
        visible={shareOpen !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setShareOpen(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShareOpen(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>
              {shareOpen === 'package' ? uiCopy.b2bChat.pickPackage : uiCopy.b2bChat.pickModel}
            </Text>
            {shareOpen === 'package' ? (
              <Text style={styles.modalHint}>{uiCopy.b2bChat.pickPackageHint}</Text>
            ) : null}
            <ScrollView style={{ maxHeight: 280 }}>
              {shareOpen === 'package'
                ? guestLinks.map((g) => (
                    <TouchableOpacity
                      key={g.id}
                      style={[styles.pickRow, sending && { opacity: 0.4 }]}
                      disabled={sending}
                      onPress={() =>
                        void sendRich('package', uiCopy.b2bChat.sharedPackageBody, {
                          package_id: g.id,
                          guest_link: buildGuestUrl(g.id),
                          preview_model_ids: g.model_ids.slice(0, 4),
                          package_label: String(g.model_ids?.length ?? 0),
                          package_name: g.label ?? null,
                        })
                      }
                    >
                      <Text style={styles.pickRowText}>
                        {g.agency_name || g.agency_email || g.id.slice(0, 8)} ·{' '}
                        {g.model_ids?.length ?? 0} {uiCopy.b2bChat.modelsCount}
                      </Text>
                    </TouchableOpacity>
                  ))
                : modelsForShare.map((mod) => (
                    <TouchableOpacity
                      key={mod.id}
                      style={[styles.pickRow, sending && { opacity: 0.4 }]}
                      disabled={sending}
                      onPress={() =>
                        void sendRich(
                          'model',
                          `${uiCopy.b2bChat.sharedModelBodyPrefix} ${mod.name}`,
                          {
                            model_id: mod.id,
                          },
                        )
                      }
                    >
                      <Text style={styles.pickRowText}>{mod.name}</Text>
                    </TouchableOpacity>
                  ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShareOpen(null)}>
              <Text style={styles.modalCloseLabel}>{uiCopy.common.cancel}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  chatPanel: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  chatPanelTitleBtn: {
    alignSelf: 'flex-start',
  },
  chatPanelTitle: {
    ...typography.label,
    color: colors.textPrimary,
    fontFamily: 'serif',
    marginBottom: spacing.xs,
  },
  chatPanelTitleClickable: {
    textDecorationLine: 'underline',
  },
  chatPanelTitleCompact: {
    marginBottom: 2,
  },
  threadContextSubheader: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    letterSpacing: 0.3,
  },
  threadContextSubheaderCompact: {
    marginBottom: spacing.xs,
  },
  assignmentPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  assignmentPillLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textPrimary,
  },
  shareRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  shareRowCompact: {
    flexWrap: 'nowrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  shareBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  shareBtnCompact: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  shareBtnLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
  },
  shareBtnLabelCompact: {
    fontSize: 10,
  },
  msgBlock: {
    marginBottom: spacing.sm,
  },
  senderLine: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 1,
  },
  bubbleRow: {
    width: '100%',
    marginBottom: spacing.xs,
  },
  /** Prevents default column stretch so bubbles size to content (max msgBubble). */
  bubbleRowOutgoing: {
    alignItems: 'flex-end',
  },
  bubbleRowIncoming: {
    alignItems: 'flex-start',
  },
  msgBubble: {
    maxWidth: CHAT_BUBBLE_MAX_WIDTH,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chatBubbleTextInBubble: {
    ...typography.body,
    fontSize: 12,
  },
  linkTextInBubble: {
    ...typography.body,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  attachmentRow: {
    width: '100%',
    marginBottom: spacing.xs,
  },
  attachmentRowOutgoing: {
    alignItems: 'flex-end',
  },
  attachmentRowIncoming: {
    alignItems: 'flex-start',
  },
  chatBubbleText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  linkText: {
    ...typography.body,
    fontSize: 12,
    color: colors.accentGreen,
    textDecorationLine: 'underline',
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardTitle: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
  },
  accessBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  accessBadgeFull: {
    backgroundColor: colors.buttonOptionGreen,
  },
  accessBadgeGuest: {
    backgroundColor: colors.border,
  },
  accessBadgeLabel: {
    ...typography.label,
    fontSize: 9,
    fontWeight: '700',
  },
  accessBadgeLabelFull: {
    color: '#fff',
  },
  accessBadgeLabelGuest: {
    color: colors.textSecondary,
  },
  modalHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 16,
  },
  packageLabel: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '600',
    marginBottom: 2,
  },
  chatSubText: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  avatarRow: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: spacing.xs,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 6,
    overflow: 'hidden',
  },
  avatarPlaceholder: {
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  cardBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.buttonOptionGreen,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 8,
  },
  cardBtnLabel: {
    ...typography.label,
    fontSize: 11,
    color: '#fff',
  },
  cardBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.buttonOptionGreen,
  },
  cardBtnLabelSecondary: {
    ...typography.label,
    fontSize: 11,
    color: colors.buttonOptionGreen,
  },
  metaHint: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  statusBadgeCancelled: {
    backgroundColor: '#e5392520',
  },
  statusBadgeConfirmed: {
    backgroundColor: '#1a8f4320',
  },
  statusBadgeLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textPrimary,
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  actionBtnConfirm: {
    backgroundColor: colors.textPrimary,
  },
  actionBtnCancel: {
    backgroundColor: colors.border,
  },
  actionBtnLabel: {
    ...typography.label,
    fontSize: 11,
    fontWeight: '600',
    color: colors.surface,
  },
  attachedImage: {
    width: '100%',
    maxWidth: 200,
    height: 140,
    borderRadius: 8,
    marginBottom: spacing.xs,
    backgroundColor: colors.border,
  },
  attachedImagePlaceholder: {
    width: 200,
    height: 140,
    borderRadius: 8,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
  },
  fileCardIcon: {
    fontSize: 14,
  },
  fileCardLabel: {
    ...typography.body,
    fontSize: 11,
    color: colors.textPrimary,
    flex: 1,
  },
  fileCardOpen: {
    ...typography.label,
    fontSize: 10,
    color: colors.accentGreen,
  },
  uploadError: {
    ...typography.body,
    fontSize: 11,
    color: '#e53925',
    marginBottom: spacing.xs,
  },
  rightsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
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
  attachBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  attachBtnLabel: {
    fontSize: 14,
  },
  chatPanelInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    alignItems: 'flex-end',
    width: '100%',
    minWidth: 0,
  },
  chatPanelInput: {
    flex: 1,
    minWidth: 0,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
    minHeight: 36,
    maxHeight: 120,
  },
  chatPanelSend: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.buttonOptionGreen,
    backgroundColor: colors.buttonOptionGreen,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  chatPanelSendLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.surface,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    maxHeight: '80%',
  },
  modalTitle: {
    ...typography.label,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
  },
  pickRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickRowText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
  },
  modalClose: {
    marginTop: spacing.md,
    alignSelf: 'flex-end',
  },
  modalCloseLabel: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
  },
});

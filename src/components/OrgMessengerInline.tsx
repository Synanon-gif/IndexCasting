import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  type ViewStyle,
  Modal,
  Linking,
  Pressable,
  Image,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import {
  getMessagesWithSenderInfo,
  sendMessage as sendMessengerMessage,
  subscribeToConversation,
  type MessagePayloadType,
  type MessageWithSender,
} from '../services/messengerSupabase';
import { getModelByIdFromSupabase } from '../services/modelsSupabase';
import { buildGuestUrl, type GuestLink } from '../services/guestLinksSupabase';
import {
  bookingStatusLabel,
  type BookingEventStatus,
} from '../services/bookingEventsSupabase';

/** Organization-scoped B2B thread (client org ↔ agency org). Not a user-to-user or "connection" chat. */
export type OrgMessengerInlineProps = {
  conversationId: string;
  headerTitle: string;
  viewerUserId: string | null;
  /** When set, show Share package / model actions (agency workspace). */
  agencyId?: string | null;
  guestLinks?: GuestLink[];
  modelsForShare?: { id: string; name: string }[];
  containerStyle?: ViewStyle;
  /** Called when the user taps a booking card. Receives the booking metadata from the message. */
  onBookingCardPress?: (metadata: Record<string, unknown>) => void;
  /**
   * Called when the user taps "Request from this package" on a package card.
   * Receives the full package metadata (package_id, guest_link, preview_model_ids, etc.).
   * If not provided, the button is hidden.
   */
  onPackagePress?: (metadata: Record<string, unknown>) => void;
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
  agencyId,
  guestLinks = [],
  modelsForShare = [],
  containerStyle,
  onBookingCardPress,
  onPackagePress,
}) => {
  const [msgs, setMsgs] = useState<MessageWithSender[]>([]);
  const [input, setInput] = useState('');
  const [shareOpen, setShareOpen] = useState<'package' | 'model' | null>(null);
  const [bookingModelNames, setBookingModelNames] = useState<Record<string, string>>({});
  /** model_id → first portfolio_images URL, for package card previews */
  const [packageModelPhotos, setPackageModelPhotos] = useState<Record<string, string>>({});

  const reload = () => void getMessagesWithSenderInfo(conversationId).then(setMsgs);

  useEffect(() => {
    reload();
  }, [conversationId]);

  useEffect(() => {
    const unsub = subscribeToConversation(conversationId, () => reload());
    return unsub;
  }, [conversationId]);

  // Resolve booking model names for booking cards
  useEffect(() => {
    const bookingModelIds = Array.from(
      new Set(
        msgs
          .filter((m) => (m as { message_type?: string }).message_type === 'booking')
          .map((m) => (m as { metadata?: Record<string, unknown> }).metadata?.['model_id'])
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0),
      ),
    );
    const missing = bookingModelIds.filter((id) => !bookingModelNames[id]);
    if (missing.length === 0) return;

    void Promise.all(
      missing.map(async (modelId) => {
        const row = await getModelByIdFromSupabase(modelId);
        if (!row?.name) return;
        setBookingModelNames((prev) => ({ ...prev, [modelId]: row.name }));
      }),
    );
  }, [msgs, bookingModelNames]);

  // Resolve model preview photos for package cards
  useEffect(() => {
    const previewIds = Array.from(
      new Set(
        msgs
          .filter((m) => (m as { message_type?: string }).message_type === 'package')
          .flatMap((m) => metaStringArray(m, 'preview_model_ids')),
      ),
    );
    const missing = previewIds.filter((id) => !packageModelPhotos[id]);
    if (missing.length === 0) return;

    void Promise.all(
      missing.map(async (modelId) => {
        try {
          const row = await getModelByIdFromSupabase(modelId);
          const photo = row?.portfolio_images?.[0];
          if (!photo) return;
          setPackageModelPhotos((prev) => ({ ...prev, [modelId]: photo }));
        } catch (e) {
          console.error('packageModelPhotos lookup error:', e);
        }
      }),
    );
  }, [msgs, packageModelPhotos]);

  const sendChat = async () => {
    const text = input.trim();
    if (!text || !viewerUserId) return;
    await sendMessengerMessage(conversationId, viewerUserId, text);
    setInput('');
    reload();
  };

  const sendRich = async (type: MessagePayloadType, text: string, metadata?: Record<string, unknown>) => {
    if (!viewerUserId) return;
    await sendMessengerMessage(conversationId, viewerUserId, text, undefined, undefined, {
      messageType: type,
      metadata: metadata ?? null,
    });
    setShareOpen(null);
    reload();
  };

  const openUrl = (url: string) => {
    void Linking.openURL(url).catch(() => {});
  };

  const showShare = !!agencyId && (guestLinks.length > 0 || modelsForShare.length > 0);

  return (
    <View style={[styles.chatPanel, containerStyle]}>
      <Text style={styles.chatPanelTitle}>{headerTitle}</Text>

      {showShare ? (
        <View style={styles.shareRow}>
          {guestLinks.length > 0 ? (
            <TouchableOpacity style={styles.shareBtn} onPress={() => setShareOpen('package')}>
              <Text style={styles.shareBtnLabel}>{uiCopy.b2bChat.sharePackage}</Text>
            </TouchableOpacity>
          ) : null}
          {modelsForShare.length > 0 ? (
            <TouchableOpacity style={styles.shareBtn} onPress={() => setShareOpen('model')}>
              <Text style={styles.shareBtnLabel}>{uiCopy.b2bChat.shareModel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <ScrollView style={{ maxHeight: 220 }}>
        {msgs.map((m) => {
          const pt = payloadType(m);
          return (
            <View key={m.id} style={styles.msgBlock}>
              <Text style={styles.senderLine}>{m.senderLabel}</Text>
              {pt === 'text' ? (
                <Text style={styles.chatBubbleText}>{m.text ?? ''}</Text>
              ) : null}
              {pt === 'link' ? (
                <Pressable onPress={() => metaString(m, 'url') && openUrl(metaString(m, 'url')!)}>
                  <Text style={styles.linkText}>{m.text || metaString(m, 'url') || 'Link'}</Text>
                </Pressable>
              ) : null}
              {pt === 'package' ? (() => {
                const meta = (m as { metadata?: Record<string, unknown> }).metadata ?? {};
                const previewIds = metaStringArray(m, 'preview_model_ids');
                const packageLabel = metaString(m, 'package_label');
                const guestLink = metaString(m, 'guest_link');
                return (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>{uiCopy.b2bChat.sharedPackage}</Text>
                    {packageLabel ? (
                      <Text style={styles.packageLabel}>
                        {packageLabel} {uiCopy.b2bChat.packagePreviewLabel}
                      </Text>
                    ) : (
                      <Text style={styles.chatBubbleText} numberOfLines={2}>
                        {m.text ?? ''}
                      </Text>
                    )}
                    {previewIds.length > 0 ? (
                      <View style={styles.avatarRow}>
                        {previewIds.slice(0, 4).map((modelId) => (
                          packageModelPhotos[modelId] ? (
                            <Image
                              key={modelId}
                              source={{ uri: packageModelPhotos[modelId] }}
                              style={styles.avatar}
                              resizeMode="cover"
                            />
                          ) : (
                            <View key={modelId} style={[styles.avatar, styles.avatarPlaceholder]}>
                              <Text style={styles.avatarPlaceholderText}>?</Text>
                            </View>
                          )
                        ))}
                      </View>
                    ) : null}
                    <View style={styles.cardActions}>
                      {guestLink ? (
                        <TouchableOpacity style={styles.cardBtn} onPress={() => openUrl(guestLink)}>
                          <Text style={styles.cardBtnLabel}>{uiCopy.b2bChat.openPackage}</Text>
                        </TouchableOpacity>
                      ) : null}
                      {onPackagePress ? (
                        <TouchableOpacity
                          style={[styles.cardBtn, styles.cardBtnSecondary]}
                          onPress={() => onPackagePress(meta)}
                        >
                          <Text style={styles.cardBtnLabelSecondary}>
                            {uiCopy.b2bChat.requestFromPackage}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                );
              })() : null}
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
                    <Text style={styles.cardTitle}>{uiCopy.b2bChat.bookingCardTitle}</Text>
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
                      const label = bookingStatusLabel(rawStatus as BookingEventStatus);
                      const isCancelled = rawStatus === 'cancelled';
                      const isConfirmed =
                        rawStatus === 'model_confirmed' || rawStatus === 'completed';
                      return (
                        <View
                          style={[
                            styles.statusBadge,
                            isCancelled && styles.statusBadgeCancelled,
                            isConfirmed && styles.statusBadgeConfirmed,
                          ]}
                        >
                          <Text style={styles.statusBadgeLabel}>{label}</Text>
                        </View>
                      );
                    })()}
                  </View>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.chatPanelInputRow}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={uiCopy.b2bChat.messagePlaceholder}
          placeholderTextColor={colors.textSecondary}
          style={styles.chatPanelInput}
          editable={!!viewerUserId}
        />
        <TouchableOpacity
          style={[styles.chatPanelSend, !viewerUserId && { opacity: 0.5 }]}
          onPress={sendChat}
          disabled={!viewerUserId}
        >
          <Text style={styles.chatPanelSendLabel}>{uiCopy.b2bChat.send}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={shareOpen !== null} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShareOpen(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>
              {shareOpen === 'package' ? uiCopy.b2bChat.pickPackage : uiCopy.b2bChat.pickModel}
            </Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {shareOpen === 'package'
                ? guestLinks.map((g) => (
                    <TouchableOpacity
                      key={g.id}
                      style={styles.pickRow}
                      onPress={() =>
                        void sendRich('package', uiCopy.b2bChat.sharedPackageBody, {
                          package_id: g.id,
                          guest_link: buildGuestUrl(g.id),
                          preview_model_ids: g.model_ids.slice(0, 4),
                          package_label: String(g.model_ids.length),
                        })
                      }
                    >
                      <Text style={styles.pickRowText}>
                        {g.agency_name || g.agency_email || g.id.slice(0, 8)} · {g.model_ids?.length ?? 0}{' '}
                        {uiCopy.b2bChat.modelsCount}
                      </Text>
                    </TouchableOpacity>
                  ))
                : modelsForShare.map((mod) => (
                    <TouchableOpacity
                      key={mod.id}
                      style={styles.pickRow}
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
    </View>
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
  chatPanelTitle: {
    ...typography.label,
    color: colors.textPrimary,
    fontFamily: 'serif',
    marginBottom: spacing.sm,
  },
  shareRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  shareBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  shareBtnLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
  },
  msgBlock: {
    marginBottom: spacing.sm,
  },
  senderLine: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 2,
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
  cardTitle: {
    ...typography.label,
    fontSize: 11,
    marginBottom: 4,
    color: colors.textPrimary,
  },
  packageLabel: {
    ...typography.body,
    fontSize: 12,
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
  chatPanelInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  chatPanelInput: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
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
    padding: spacing.lg,
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

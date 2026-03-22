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
import { buildGuestUrl, type GuestLink } from '../services/guestLinksSupabase';

/** Organization-scoped B2B thread (client org ↔ agency org). Not a user-to-user or “connection” chat. */
export type OrgMessengerInlineProps = {
  conversationId: string;
  headerTitle: string;
  viewerUserId: string | null;
  /** When set, show Share package / model actions (agency workspace). */
  agencyId?: string | null;
  guestLinks?: GuestLink[];
  modelsForShare?: { id: string; name: string }[];
  containerStyle?: ViewStyle;
};

function payloadType(m: MessageWithSender): MessagePayloadType {
  const t = (m as { message_type?: string }).message_type;
  if (t === 'link' || t === 'package' || t === 'model') return t;
  return 'text';
}

function metaString(m: MessageWithSender, key: string): string | undefined {
  const raw = (m as { metadata?: Record<string, unknown> }).metadata?.[key];
  return typeof raw === 'string' ? raw : undefined;
}

export const OrgMessengerInline: React.FC<OrgMessengerInlineProps> = ({
  conversationId,
  headerTitle,
  viewerUserId,
  agencyId,
  guestLinks = [],
  modelsForShare = [],
  containerStyle,
}) => {
  const [msgs, setMsgs] = useState<MessageWithSender[]>([]);
  const [input, setInput] = useState('');
  const [shareOpen, setShareOpen] = useState<'package' | 'model' | null>(null);

  const reload = () => void getMessagesWithSenderInfo(conversationId).then(setMsgs);

  useEffect(() => {
    reload();
  }, [conversationId]);

  useEffect(() => {
    const unsub = subscribeToConversation(conversationId, () => reload());
    return unsub;
  }, [conversationId]);

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
              {pt === 'package' ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{uiCopy.b2bChat.sharedPackage}</Text>
                  <Text style={styles.chatBubbleText} numberOfLines={2}>
                    {m.text ?? ''}
                  </Text>
                  {metaString(m, 'guest_link') ? (
                    <TouchableOpacity style={styles.cardBtn} onPress={() => openUrl(metaString(m, 'guest_link')!)}>
                      <Text style={styles.cardBtnLabel}>{uiCopy.b2bChat.openPackage}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
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
  cardBtn: {
    marginTop: spacing.sm,
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
  metaHint: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
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

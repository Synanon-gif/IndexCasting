import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import {
  getMessagesWithSenderInfo,
  sendMessage as sendMessengerMessage,
  type MessageWithSender,
} from '../services/messengerSupabase';

export type ConnectionMessengerInlineProps = {
  conversationId: string;
  headerTitle: string;
  viewerUserId: string | null;
  /** Extra style for the outer wrapper (e.g. margin). */
  containerStyle?: ViewStyle;
};

/**
 * Minimal inline messenger for a single Supabase conversation (connection chats).
 * Same conversation_id is used on client and agency web.
 */
export const ConnectionMessengerInline: React.FC<ConnectionMessengerInlineProps> = ({
  conversationId,
  headerTitle,
  viewerUserId,
  containerStyle,
}) => {
  const [msgs, setMsgs] = useState<MessageWithSender[]>([]);
  const [input, setInput] = useState('');

  const reload = () => void getMessagesWithSenderInfo(conversationId).then(setMsgs);

  useEffect(() => {
    reload();
  }, [conversationId]);

  const sendChat = async () => {
    const text = input.trim();
    if (!text || !viewerUserId) return;
    await sendMessengerMessage(conversationId, viewerUserId, text);
    setInput('');
    reload();
  };

  return (
    <View style={[styles.chatPanel, containerStyle]}>
      <Text style={styles.chatPanelTitle}>{headerTitle}</Text>
      <ScrollView style={{ maxHeight: 160 }}>
        {msgs.map((m) => (
          <View key={m.id} style={styles.msgBlock}>
            <Text style={styles.senderLine}>{m.senderLabel}</Text>
            <Text style={styles.chatBubbleText}>{m.text ?? ''}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.chatPanelInputRow}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={uiCopy.connections.messagePlaceholder}
          placeholderTextColor={colors.textSecondary}
          style={styles.chatPanelInput}
          editable={!!viewerUserId}
        />
        <TouchableOpacity
          style={[styles.chatPanelSend, !viewerUserId && { opacity: 0.5 }]}
          onPress={sendChat}
          disabled={!viewerUserId}
        >
          <Text style={styles.chatPanelSendLabel}>{uiCopy.connections.send}</Text>
        </TouchableOpacity>
      </View>
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
});

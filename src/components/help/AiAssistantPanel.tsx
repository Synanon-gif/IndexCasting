import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { uiCopy } from '../../constants/uiCopy';
import { colors, spacing, typography } from '../../theme/theme';
import { askAiAssistant, type AiAssistantMessage } from '../../services/aiAssistantSupabase';
import {
  getAiAssistantDisclaimer,
  getAiAssistantSubtitle,
  type AiAssistantViewerRole,
} from './aiAssistantCopy';

type AiAssistantPanelProps = {
  visible: boolean;
  viewerRole: AiAssistantViewerRole;
  onClose: () => void;
};

export function AiAssistantPanel({ visible, viewerRole, onClose }: AiAssistantPanelProps) {
  const copy = uiCopy.aiAssistant;
  const subtitle = getAiAssistantSubtitle(viewerRole);
  const disclaimer = getAiAssistantDisclaimer(viewerRole);
  const scrollRef = useRef<ScrollView | null>(null);
  const [messages, setMessages] = useState<AiAssistantMessage[]>([
    { role: 'assistant', content: copy.initialMessage },
  ]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = useMemo(() => draft.trim().length > 0 && !pending, [draft, pending]);

  const scrollToEnd = () => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const send = async () => {
    const question = draft.trim();
    if (!question) {
      setError(copy.emptyQuestion);
      return;
    }
    if (pending) return;

    const nextMessages: AiAssistantMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(nextMessages);
    setDraft('');
    setError(null);
    setPending(true);
    scrollToEnd();

    try {
      const result = await askAiAssistant({
        message: question,
        viewerRole,
        history: nextMessages.slice(-6),
      });
      if (result.ok) {
        setMessages((current) => [...current, { role: 'assistant', content: result.answer }]);
      } else {
        setError(copy.unavailable);
      }
    } finally {
      setPending(false);
      scrollToEnd();
    }
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel={copy.closeLabel}
          accessibilityRole="button"
        />
        <View style={styles.panel}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>{copy.title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityLabel={copy.closeLabel}
              accessibilityRole="button"
            >
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          <Text style={styles.disclaimer}>{disclaimer}</Text>

          <ScrollView
            ref={scrollRef}
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={scrollToEnd}
          >
            {messages.map((message, index) => (
              <View
                key={`${message.role}-${index}`}
                style={[
                  styles.bubble,
                  message.role === 'user' ? styles.userBubble : styles.assistantBubble,
                ]}
              >
                <Text
                  style={[
                    styles.bubbleText,
                    message.role === 'user' ? styles.userBubbleText : null,
                  ]}
                >
                  {message.content}
                </Text>
              </View>
            ))}
            {pending ? (
              <View style={[styles.bubble, styles.assistantBubble, styles.loadingBubble]}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
                <Text style={styles.loadingText}>{copy.sending}</Text>
              </View>
            ) : null}
          </ScrollView>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={copy.inputPlaceholder}
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              editable={!pending}
              returnKeyType="send"
              onSubmitEditing={send}
              accessibilityLabel={copy.inputPlaceholder}
            />
            <Pressable
              onPress={send}
              disabled={!canSend}
              style={[styles.sendButton, !canSend ? styles.sendButtonDisabled : null]}
              accessibilityRole="button"
              accessibilityLabel={copy.send}
            >
              <Text style={styles.sendButtonText}>{pending ? copy.sending : copy.send}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,17,17,0.18)',
  },
  panel: {
    width: Platform.OS === 'web' ? 380 : '100%',
    maxWidth: '100%',
    maxHeight: Platform.OS === 'web' ? 560 : '82%',
    margin: Platform.OS === 'web' ? spacing.lg : 0,
    borderRadius: Platform.OS === 'web' ? 22 : 20,
    borderBottomLeftRadius: Platform.OS === 'web' ? 22 : 0,
    borderBottomRightRadius: Platform.OS === 'web' ? 22 : 0,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: colors.black,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.headingCompact,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  close: {
    fontSize: 24,
    lineHeight: 26,
    color: colors.textSecondary,
  },
  disclaimer: {
    ...typography.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    paddingVertical: spacing.xs,
  },
  messages: {
    minHeight: 180,
    maxHeight: 320,
  },
  messagesContent: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  bubble: {
    maxWidth: '88%',
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.textPrimary,
  },
  bubbleText: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textPrimary,
  },
  userBubbleText: {
    color: colors.surface,
  },
  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  errorText: {
    ...typography.body,
    fontSize: 12,
    color: colors.errorDark,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    ...typography.body,
    fontSize: 13,
  },
  sendButton: {
    minHeight: 42,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.textPrimary,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  sendButtonText: {
    ...typography.label,
    fontSize: 11,
    color: colors.surface,
  },
});

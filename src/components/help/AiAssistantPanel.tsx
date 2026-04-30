import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  askAiAssistant,
  type AiAssistantContext,
  type AiAssistantMessage,
  getAiAssistantConsentScope,
  isAiAssistantConsentSatisfied,
  recordAiAssistantUserConsent,
} from '../../services/aiAssistantSupabase';
import { AI_ASSISTANT_CONSENT_REQUIRED_ANSWER } from '../../constants/aiAssistantConsent';
import {
  getAiAssistantDisclaimer,
  getAiAssistantSubtitle,
  type AiAssistantViewerRole,
} from './aiAssistantCopy';
import { AiAssistantConsentModal } from './AiAssistantConsentModal';

type ConsentGateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'error' }
  | { phase: 'ready'; orgId: string | null }
  | { phase: 'blocked'; orgId: string };

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
  const [assistantContext, setAssistantContext] = useState<AiAssistantContext | null>(null);
  const [consentGate, setConsentGate] = useState<ConsentGateState>({ phase: 'idle' });

  useEffect(() => {
    setAssistantContext(null);
  }, [viewerRole]);

  useEffect(() => {
    if (!visible) setAssistantContext(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setConsentGate({ phase: 'idle' });
      return;
    }
    let cancelled = false;
    (async () => {
      setConsentGate({ phase: 'checking' });
      try {
        const scope = await getAiAssistantConsentScope();
        if (cancelled) return;
        if (!scope.organizationId) {
          setConsentGate({ phase: 'ready', orgId: null });
          return;
        }
        const satisfied = await isAiAssistantConsentSatisfied(scope.organizationId);
        if (cancelled) return;
        if (satisfied) {
          setConsentGate({ phase: 'ready', orgId: scope.organizationId });
        } else {
          setConsentGate({ phase: 'blocked', orgId: scope.organizationId });
        }
      } catch {
        if (!cancelled) setConsentGate({ phase: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const consentReady = consentGate.phase === 'ready';
  const canSend = useMemo(
    () => draft.trim().length > 0 && !pending && consentReady,
    [draft, pending, consentReady],
  );

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
    if (consentGate.phase === 'checking') {
      setError(copy.consentRequiredBeforeUse);
      return;
    }
    if (consentGate.phase === 'error') {
      setError(copy.consentVerificationFailed);
      return;
    }
    if (!consentReady) {
      setError(copy.consentRequiredBeforeUse);
      return;
    }

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
        context: assistantContext,
      });
      if (result.ok) {
        if (result.answer.trim() === AI_ASSISTANT_CONSENT_REQUIRED_ANSWER) {
          setMessages((current) => current.slice(0, -1));
          setDraft(question);
          setAssistantContext(null);
          setError(copy.consentRequiredBeforeUse);
        } else {
          setAssistantContext(result.context ?? null);
          setMessages((current) => [
            ...current,
            { role: 'assistant', content: result.answer, context: result.context },
          ]);
        }
      } else {
        setAssistantContext(null);
        setError(copy.unavailable);
      }
    } finally {
      setPending(false);
      scrollToEnd();
    }
  };

  return (
    <>
      <AiAssistantConsentModal
        visible={visible && consentGate.phase === 'blocked'}
        onDecline={onClose}
        onAccept={async () => {
          if (consentGate.phase !== 'blocked') return;
          const { ok } = await recordAiAssistantUserConsent(consentGate.orgId);
          if (!ok) {
            setError(copy.consentSaveFailed);
            return;
          }
          setError(null);
          setMessages([{ role: 'assistant', content: copy.initialMessage }]);
          setAssistantContext(null);
          setConsentGate({ phase: 'ready', orgId: consentGate.orgId });
        }}
      />
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

            {consentGate.phase === 'checking' ? (
              <View style={styles.consentCheckingRow}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
                <Text style={styles.consentCheckingText}>{copy.checkingConsent}</Text>
              </View>
            ) : null}
            {consentGate.phase === 'error' ? (
              <Text style={styles.errorText}>{copy.consentVerificationFailed}</Text>
            ) : null}

            <ScrollView
              ref={scrollRef}
              style={styles.messages}
              contentContainerStyle={styles.messagesContent}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={scrollToEnd}
              onLayout={scrollToEnd}
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
                editable={!pending && consentReady}
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
    </>
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
  consentCheckingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  consentCheckingText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  messages: {
    flexGrow: 1,
    minHeight: 180,
    maxHeight: 320,
  },
  messagesContent: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  bubble: {
    maxWidth: '88%',
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm,
    overflow: 'visible',
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
    paddingTop: 1,
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
    minWidth: 0,
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    textAlignVertical: 'center',
    ...typography.body,
    fontSize: 13,
  },
  sendButton: {
    flexShrink: 0,
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

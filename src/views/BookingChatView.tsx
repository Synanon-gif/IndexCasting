/**
 * Standalone booking chat (Agency–Model recruiting thread).
 * Used by the model to open a chat from "Booking chats" or from a ?booking= thread link.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ScrollView, Image } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import {
  getRecruitingMessages,
  addRecruitingMessage,
  getRecruitingThread,
  subscribeRecruitingChats,
  addModelBookingThreadId,
} from '../store/recruitingChats';
import { getApplicationById } from '../store/applicationsStore';
import { getAgencyById, type Agency } from '../services/agenciesSupabase';

type Props = {
  threadId: string;
  fromRole: 'agency' | 'model';
  onClose: () => void;
};

export const BookingChatView: React.FC<Props> = ({ threadId, fromRole, onClose }) => {
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState(() => getRecruitingMessages(threadId));
  const [agencyBrand, setAgencyBrand] = useState<Agency | null>(null);
  const thread = getRecruitingThread(threadId);
  const application = thread ? getApplicationById(thread.applicationId) : undefined;

  useEffect(() => {
    if (fromRole === 'model') addModelBookingThreadId(threadId);
  }, [threadId, fromRole]);

  useEffect(() => {
    const aid = application?.agencyId;
    if (!aid) {
      setAgencyBrand(null);
      return;
    }
    getAgencyById(aid).then(setAgencyBrand);
  }, [application?.agencyId]);

  useEffect(() => {
    const refresh = () => setMessages(getRecruitingMessages(threadId));
    refresh();
    const unsub = subscribeRecruitingChats(refresh);
    return unsub;
  }, [threadId]);

  const sendMessage = () => {
    const t = chatInput.trim();
    if (!t) return;
    addRecruitingMessage(threadId, fromRole, t);
    setChatInput('');
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              {fromRole === 'model' && agencyBrand ? (
                <View style={styles.brandRow}>
                  {agencyBrand.logo_url ? (
                    <Image source={{ uri: agencyBrand.logo_url }} style={styles.agencyLogo} resizeMode="contain" />
                  ) : (
                    <View style={styles.agencyLogoPlaceholder}>
                      <Text style={styles.agencyLogoLetter}>{(agencyBrand.name || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.agencyName}>{agencyBrand.name}</Text>
                    <Text style={styles.subtitle}>You are chatting with this agency</Text>
                    <Text style={styles.modelLine}>Applicant: {thread?.modelName ?? '—'}</Text>
                  </View>
                </View>
              ) : (
                <>
                  <Text style={styles.title}>{thread ? thread.modelName : 'Chat'}</Text>
                  {fromRole === 'agency' && agencyBrand && (
                    <View style={styles.brandRow}>
                      {agencyBrand.logo_url ? (
                        <Image source={{ uri: agencyBrand.logo_url }} style={styles.agencyLogoSmall} resizeMode="contain" />
                      ) : null}
                      <Text style={styles.replyingAs}>Replying as {agencyBrand.name}</Text>
                    </View>
                  )}
                  {application && (
                    <Text style={styles.subtitle}>
                      {application.city || '—'} · {application.height} cm · {application.gender || '—'}
                    </Text>
                  )}
                </>
              )}
            </View>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeLabel}>Close</Text>
            </TouchableOpacity>
          </View>
          {application && (
            <View style={styles.profileRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {[application.images?.closeUp, application.images?.fullBody, application.images?.profile]
                  .filter(Boolean)
                  .map((uri, idx) => (
                    <Image
                      key={idx}
                      source={{ uri: uri! }}
                      style={styles.profileImage}
                      resizeMode="cover"
                    />
                  ))}
              </ScrollView>
            </View>
          )}
          <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
            {messages.map((msg) => (
              <View
                key={msg.id}
                style={[
                  styles.bubble,
                  msg.from === fromRole ? styles.bubbleSelf : styles.bubbleOther,
                ]}
              >
                <Text style={[styles.bubbleText, msg.from === fromRole && styles.bubbleTextSelf]}>
                  {msg.text}
                </Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.inputRow}>
            <TextInput
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Message..."
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <TouchableOpacity style={styles.send} onPress={sendMessage}>
              <Text style={styles.sendLabel}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  subtitle: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  agencyLogo: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  agencyLogoSmall: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  agencyLogoPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agencyLogoLetter: {
    ...typography.heading,
    fontSize: 18,
    color: colors.surface,
  },
  agencyName: {
    ...typography.heading,
    fontSize: 15,
    color: colors.textPrimary,
  },
  modelLine: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  replyingAs: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
  },
  title: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
  },
  messagesContent: {
    flexGrow: 1,
    paddingBottom: spacing.sm,
  },
  closeLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  profileRow: {
    marginBottom: spacing.sm,
  },
  profileImage: {
    width: 72,
    height: 90,
    borderRadius: 8,
    backgroundColor: colors.border,
    marginRight: spacing.sm,
  },
  messages: {
    maxHeight: 240,
    marginBottom: spacing.sm,
  },
  bubble: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    marginBottom: spacing.xs,
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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

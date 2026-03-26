/**
 * Booking chat (Agency–Model thread).
 * Used by the model to open a chat from "Booking chats" or from a ?booking= thread link.
 * This view is shown AFTER the agency has accepted the model's application.
 * Before acceptance, the chat is a Recruiting Chat (handled in AgencyRecruitingView).
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ScrollView, Image, Platform, ActivityIndicator, Linking, Pressable } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
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

type Props = {
  threadId: string;
  fromRole: 'agency' | 'model';
  onClose: () => void;
  /** Sofort angezeigter Agenturname (z. B. aus Messages-Liste), bevor Supabase antwortet. */
  initialAgencyName?: string | null;
  /** agency_id der zugehörigen Bewerbung – zuverlässiger als globaler Applications-Store. */
  applicationAgencyId?: string | null;
};

export const BookingChatView: React.FC<Props> = ({ threadId, fromRole, onClose, initialAgencyName, applicationAgencyId }) => {
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState(() => getRecruitingMessages(threadId));
  const [agencyName, setAgencyName] = useState<string | null>(initialAgencyName ?? null);
  const [agencyLogoUrl, setAgencyLogoUrl] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  }, [messages]);

  const sendMessage = () => {
    const t = chatInput.trim();
    if (!t) return;
    // Auto-promote messages containing a URL to include the link
    addRecruitingMessage(threadId, fromRole, t);
    setChatInput('');
  };

  const openUrl = (url: string) => {
    void Linking.openURL(url).catch(() => {});
  };

  const handleFileSelected = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      await addRecruitingMessageWithFile(threadId, fromRole, file, file.name);
    } catch (e) {
      console.error('handleFileSelected error:', e);
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openFileInput = () => {
    if (Platform.OS === 'web' && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const displayAgencyName = agencyName || initialAgencyName || 'Agency';

  const copyBookingLink = () => {
    if (typeof window === 'undefined' || !threadId) return;
    const url = `${window.location.origin}${window.location.pathname || ''}?booking=${threadId}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              {fromRole === 'model' ? (
                <View style={styles.modelAgencyBanner}>
                  <Text style={styles.modelAgencyKicker}>You are chatting with</Text>
                  <View style={styles.brandRow}>
                    {agencyLogoUrl ? (
                      <Image source={{ uri: agencyLogoUrl }} style={styles.agencyLogo} resizeMode="contain" />
                    ) : (
                      <View style={styles.agencyLogoPlaceholder}>
                        <Text style={styles.agencyLogoLetter}>{displayAgencyName.charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.agencyName}>{displayAgencyName}</Text>
                      {thread ? <Text style={styles.modelLine}>As: {thread.modelName}</Text> : null}
                    </View>
                  </View>
                </View>
              ) : (
                <View>
                  <Text style={styles.title}>{thread ? thread.modelName : 'Chat'}</Text>
                  {application && (
                    <Text style={styles.subtitle}>
                      {application.city || '—'} · {application.height} cm · {application.gender || '—'}
                    </Text>
                  )}
                  {thread?.chatType === 'active_model' && (
                    <View style={styles.chatTypeBadge}>
                      <Text style={styles.chatTypeBadgeLabel}>Active Model</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
            <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
              {fromRole === 'agency' && Platform.OS === 'web' && (
                <TouchableOpacity onPress={copyBookingLink}>
                  <Text style={styles.copyLinkLabel}>Link for model</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose}>
                <Text style={styles.closeLabel}>Close</Text>
              </TouchableOpacity>
            </View>
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
                      resizeMode="contain"
                    />
                  ))}
              </ScrollView>
            </View>
          )}
          <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
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
                          resizeMode="cover"
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
                    <View style={[styles.bubble, isSelf ? styles.bubbleSelf : styles.bubbleOther]}>
                      <Text style={[styles.bubbleText, isSelf && styles.bubbleTextSelf]}>
                        {msg.text}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          {uploadError ? <Text style={styles.uploadError}>{uploadError}</Text> : null}
          <View style={styles.inputRow}>
            {Platform.OS === 'web' ? (
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileSelected(file);
                }}
              />
            ) : null}
            <TouchableOpacity
              style={[styles.attachBtn, (!fromRole || uploading) && { opacity: 0.4 }]}
              onPress={openFileInput}
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
              style={styles.input}
              editable={!uploading}
              onSubmitEditing={sendMessage}
            />
            <TouchableOpacity style={[styles.send, uploading && { opacity: 0.5 }]} onPress={sendMessage} disabled={uploading}>
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
  chatTypeBadge: {
    alignSelf: 'flex-start',
    marginTop: 4,
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
  copyLinkLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.buttonOptionGreen,
  },
  modelAgencyBanner: {
    marginBottom: spacing.xs,
  },
  modelAgencyKicker: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
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
  bubbleWrapper: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
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
  uploadError: {
    ...typography.body,
    fontSize: 11,
    color: '#e53925',
    marginBottom: spacing.xs,
    marginHorizontal: spacing.xs,
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

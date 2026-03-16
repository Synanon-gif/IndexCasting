/**
 * Agency-Recruiting-Screen: Tinder-ähnliche Ansicht für Booker.
 * Bewerbungen nacheinander; Swipe/Buttons: In Auswahl übernehmen (Ja) / Absage (Nein).
 * Bei Ja: Bestätigung simulieren, Chat mit Agentur öffnen.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Modal,
  TextInput,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import {
  getPendingApplications,
  getAcceptedApplications,
  acceptApplication,
  rejectApplication,
  subscribeApplications,
  type ModelApplication,
  type Gender,
} from '../store/applicationsStore';
import {
  getRecruitingMessages,
  addRecruitingMessage,
  getRecruitingThread,
  getRecruitingThreads,
} from '../store/recruitingChats';

type HeightFilter = 'all' | 'short' | 'medium' | 'tall';

function filterApplications(
  list: ModelApplication[],
  heightFilter: HeightFilter,
  genderFilter: Gender | '',
  hairFilter: string,
  cityFilter: string
): ModelApplication[] {
  return list.filter((a) => {
    if (heightFilter !== 'all') {
      if (heightFilter === 'short' && a.height >= 175) return false;
      if (heightFilter === 'medium' && (a.height < 175 || a.height > 182)) return false;
      if (heightFilter === 'tall' && a.height <= 182) return false;
    }
    if (genderFilter && (a.gender ?? '') !== genderFilter) return false;
    if (hairFilter && !((a.hairColor ?? '').toLowerCase().includes(hairFilter.toLowerCase()))) return false;
    if (cityFilter && (a.city || '') !== cityFilter) return false;
    return true;
  });
}

export const AgencyRecruitingView: React.FC<{ onBack: () => void; agencyId: string }> = ({ onBack, agencyId }) => {
  const [recruitTab, setRecruitTab] = useState<'pending' | 'accepted'>('pending');
  const [allPending, setAllPending] = useState<ModelApplication[]>([]);
  const [heightFilter, setHeightFilter] = useState<HeightFilter>('all');
  const [genderFilter, setGenderFilter] = useState<Gender | ''>('');
  const [hairFilter, setHairFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [chatThreadId, setChatThreadId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [showBookingChats, setShowBookingChats] = useState(false);

  const applications = filterApplications(allPending, heightFilter, genderFilter, hairFilter, cityFilter);
  const current = applications[index] ?? null;
  const acceptedList = getAcceptedApplications();
  const allThreads = getRecruitingThreads();
  const uniqueCities = React.useMemo(() => Array.from(new Set(allPending.map((a) => a.city).filter(Boolean))).sort(), [allPending]);
  const uniqueHair = React.useMemo(() => Array.from(new Set(allPending.map((a) => a.hairColor).filter(Boolean))).sort(), [allPending]);

  useEffect(() => {
    setAllPending(getPendingApplications());
    const unsub = subscribeApplications(() => setAllPending(getPendingApplications()));
    return unsub;
  }, []);

  useEffect(() => {
    setIndex((i) => (i >= applications.length ? Math.max(0, applications.length - 1) : i));
  }, [applications.length]);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleYes = async () => {
    if (!current || !agencyId) return;
    const threadId = await acceptApplication(current.id, agencyId);
    if (threadId) {
      showFeedback('Added to selection. Confirmation email sent.');
      setChatThreadId(threadId);
      setAllPending(getPendingApplications());
      setIndex((i) => Math.min(i, Math.max(0, applications.length - 2)));
    }
  };

  const handleNo = async () => {
    if (!current) return;
    await rejectApplication(current.id);
    showFeedback('Application declined (archived).');
    setAllPending(getPendingApplications());
    if (index >= applications.length - 1) setIndex((i) => Math.max(0, i - 1));
  };

  const closeChat = () => {
    setChatThreadId(null);
    setChatInput('');
  };

  const sendChatMessage = () => {
    const text = chatInput.trim();
    if (!text || !chatThreadId) return;
    addRecruitingMessage(chatThreadId, 'agency', text);
    setChatInput('');
  };

  const messages = chatThreadId ? getRecruitingMessages(chatThreadId) : [];
  const thread = chatThreadId ? getRecruitingThread(chatThreadId) : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.brand}>Recruiting</Text>
        <Text style={styles.counter}>
          {applications.length ? `${index + 1} / ${applications.length}` : '0 / 0'}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {(['pending', 'accepted'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.filterPill, recruitTab === t && styles.filterPillActive]}
            onPress={() => setRecruitTab(t)}
          >
            <Text style={[styles.filterPillText, recruitTab === t && styles.filterPillTextActive]}>
              {t === 'pending' ? `Pending (${applications.length})` : `Accepted (${acceptedList.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {recruitTab === 'accepted' ? (
        <ScrollView style={{ flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          {acceptedList.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No accepted applications</Text>
              <Text style={styles.emptyCopy}>Accepted models will appear here.</Text>
            </View>
          ) : (
            acceptedList.map((app) => (
              <View key={app.id} style={styles.bookingChatRow}>
                <Text style={styles.bookingChatName}>{app.firstName} {app.lastName}</Text>
                <TouchableOpacity style={styles.bookingChatOpen} onPress={() => app.chatThreadId && setChatThreadId(app.chatThreadId)}>
                  <Text style={styles.bookingChatOpenLabel}>Open chat</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      ) : (
      <View style={{ flex: 1 }}>

      <TouchableOpacity style={styles.filterToggle} onPress={() => setFilterOpen((o) => !o)}>
        <Text style={styles.filterToggleLabel}>Filters</Text>
        <Text style={styles.filterToggleArrow}>{filterOpen ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      {filterOpen && (
        <View style={styles.filterRow}>
          <Text style={styles.filterLabel}>Height</Text>
          <View style={styles.filterPills}>
            {(['all', 'short', 'medium', 'tall'] as const).map((h) => (
              <TouchableOpacity key={h} style={[styles.filterPill, heightFilter === h && styles.filterPillActive]} onPress={() => setHeightFilter(h)}>
                <Text style={[styles.filterPillText, heightFilter === h && styles.filterPillTextActive]}>{h === 'all' ? 'All' : h === 'short' ? '<175' : h === 'medium' ? '175–182' : '>182'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.filterLabel}>Gender</Text>
          <View style={styles.filterPills}>
            {(['', 'female', 'male', 'diverse'] as const).map((g) => (
              <TouchableOpacity key={g || 'all'} style={[styles.filterPill, genderFilter === g && styles.filterPillActive]} onPress={() => setGenderFilter(g)}>
                <Text style={[styles.filterPillText, genderFilter === g && styles.filterPillTextActive]}>{g ? (g === 'female' ? 'Female' : g === 'male' ? 'Male' : 'Diverse') : 'All'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.filterLabel}>Hair</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
            <TouchableOpacity style={[styles.filterPill, !hairFilter && styles.filterPillActive]} onPress={() => setHairFilter('')}>
              <Text style={[styles.filterPillText, !hairFilter && styles.filterPillTextActive]}>All</Text>
            </TouchableOpacity>
            {uniqueHair.map((h) => (
              <TouchableOpacity key={h} style={[styles.filterPill, hairFilter === h && styles.filterPillActive]} onPress={() => setHairFilter(h)}>
                <Text style={[styles.filterPillText, hairFilter === h && styles.filterPillTextActive]}>{h}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.filterLabel}>City</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
            <TouchableOpacity style={[styles.filterPill, !cityFilter && styles.filterPillActive]} onPress={() => setCityFilter('')}>
              <Text style={[styles.filterPillText, !cityFilter && styles.filterPillTextActive]}>All</Text>
            </TouchableOpacity>
            {uniqueCities.map((c) => (
              <TouchableOpacity key={c} style={[styles.filterPill, cityFilter === c && styles.filterPillActive]} onPress={() => setCityFilter(c)}>
                <Text style={[styles.filterPillText, cityFilter === c && styles.filterPillTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <TouchableOpacity style={styles.bookingChatsToggle} onPress={() => setShowBookingChats((s) => !s)}>
        <Text style={styles.filterToggleLabel}>Booking chats ({acceptedList.length})</Text>
        <Text style={styles.filterToggleArrow}>{showBookingChats ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      {showBookingChats && acceptedList.length > 0 && (
        <ScrollView style={styles.bookingChatsList} horizontal={false}>
          {acceptedList.map((app) => {
            const thread = app.chatThreadId ? allThreads.find((t) => t.id === app.chatThreadId) : null;
            return (
              <View key={app.id} style={styles.bookingChatRow}>
                <Text style={styles.bookingChatName}>{app.firstName} {app.lastName}</Text>
                <TouchableOpacity
                  style={styles.bookingChatOpen}
                  onPress={() => app.chatThreadId && setChatThreadId(app.chatThreadId)}
                >
                  <Text style={styles.bookingChatOpenLabel}>Open chat</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}

      {current ? (
        <View style={styles.cardWrap}>
          <View style={styles.card}>
            <View style={styles.cardImageWrap}>
              {(current.images?.closeUp || current.images?.fullBody || current.images?.profile) ? (
                <Image
                  source={{ uri: current.images.closeUp || current.images.fullBody || current.images.profile }}
                  style={styles.cardImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.cardImagePlaceholder}>
                  <Text style={styles.cardImagePlaceholderText}>{current.firstName} {current.lastName}</Text>
                </View>
              )}
              <View style={styles.cardOverlay}>
                <Text style={styles.cardName}>
                  {current.firstName} {current.lastName}
                </Text>
                <Text style={styles.cardMeta}>
                  {current.age} · {current.height} cm · {current.city}
                </Text>
                {current.instagramLink ? (
                  <Text style={styles.cardMeta} numberOfLines={1}>{current.instagramLink}</Text>
                ) : null}
              </View>
            </View>
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.buttonNo} onPress={handleNo}>
                <Text style={styles.buttonNoLabel}>No</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.buttonYes} onPress={handleYes}>
                <Text style={styles.buttonYesLabel}>Add to selection</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No pending applications</Text>
          <Text style={styles.emptyCopy}>New applications will appear here.</Text>
        </View>
      )}

      </View>
      )}

      {feedback && (
        <View style={styles.feedbackBanner}>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>
      )}

      <Modal
        visible={!!chatThreadId}
        transparent
        animationType="fade"
        onRequestClose={closeChat}
      >
        <View style={styles.chatOverlay}>
          <View style={styles.chatCard}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle}>
                {thread ? thread.modelName : 'Chat'}
              </Text>
              <View style={styles.chatHeaderActions}>
                {typeof window !== 'undefined' && thread && (
                  <TouchableOpacity
                    style={styles.copyLinkBtn}
                    onPress={() => {
                      const url = `${window.location.origin}${window.location.pathname || ''}?booking=${thread.id}`;
                      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(url);
                        setFeedback('Link copied. Send to model.');
                        setTimeout(() => setFeedback(null), 2000);
                      }
                    }}
                  >
                    <Text style={styles.copyLinkLabel}>Copy link</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={closeChat}>
                  <Text style={styles.closeLabel}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={styles.chatMessages}>
              {messages.map((msg) => (
                <View
                  key={msg.id}
                  style={[
                    styles.chatBubble,
                    msg.from === 'agency' ? styles.chatBubbleAgency : styles.chatBubbleModel,
                  ]}
                >
                  <Text style={[styles.chatBubbleText, msg.from === 'agency' && styles.chatBubbleTextAgency]}>
                    {msg.text}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <View style={styles.chatInputRow}>
              <TextInput
                value={chatInput}
                onChangeText={setChatInput}
                placeholder="Message..."
                placeholderTextColor={colors.textSecondary}
                style={styles.chatInput}
              />
              <TouchableOpacity style={styles.chatSend} onPress={sendChatMessage}>
                <Text style={styles.chatSendLabel}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backArrow: {
    fontSize: 24,
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },
  brand: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    flex: 1,
  },
  counter: {
    ...typography.label,
    color: colors.textSecondary,
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterToggleLabel: {
    ...typography.label,
    color: colors.textPrimary,
  },
  filterToggleArrow: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 10,
  },
  filterRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  filterPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  filterScroll: {
    marginBottom: spacing.xs,
    maxHeight: 36,
  },
  filterPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.xs,
  },
  filterPillActive: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.textPrimary,
  },
  filterPillText: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  filterPillTextActive: {
    color: colors.surface,
  },
  bookingChatsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bookingChatsList: {
    maxHeight: 160,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bookingChatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  bookingChatName: {
    ...typography.body,
    color: colors.textPrimary,
  },
  bookingChatOpen: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.textPrimary,
  },
  bookingChatOpenLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.surface,
  },
  cardWrap: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardImageWrap: {
    height: 380,
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#D0CEC7',
  },
  cardImagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#E2E0DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImagePlaceholderText: {
    ...typography.heading,
    color: colors.textSecondary,
  },
  cardOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  cardName: {
    ...typography.heading,
    fontSize: 20,
    color: colors.surface,
  },
  cardMeta: {
    ...typography.body,
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 4,
  },
  cardActions: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.md,
  },
  buttonNo: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.buttonSkipRed,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonNoLabel: {
    ...typography.label,
    color: colors.buttonSkipRed,
  },
  buttonYes: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: colors.buttonOptionGreen,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonYesLabel: {
    ...typography.label,
    color: colors.surface,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emptyCopy: {
    ...typography.body,
    color: colors.textSecondary,
  },
  feedbackBanner: {
    position: 'absolute',
    bottom: spacing.xl,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.textPrimary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
  },
  feedbackText: {
    ...typography.label,
    color: colors.surface,
  },
  chatOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  chatCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  chatHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  copyLinkBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  copyLinkLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  chatTitle: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
  },
  closeLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  chatMessages: {
    maxHeight: 240,
    marginBottom: spacing.sm,
  },
  chatBubble: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    marginBottom: spacing.xs,
    backgroundColor: '#F0EEEA',
  },
  chatBubbleAgency: {
    alignSelf: 'flex-end',
    backgroundColor: colors.buttonOptionGreen,
  },
  chatBubbleModel: {
    alignSelf: 'flex-start',
  },
  chatBubbleText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
  },
  chatBubbleTextAgency: {
    color: colors.surface,
  },
  chatInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
  },
  chatSend: {
    backgroundColor: colors.buttonOptionGreen,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  chatSendLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.surface,
  },
});


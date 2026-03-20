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
  refreshApplications,
  subscribeApplications,
  type ModelApplication,
  type Gender,
} from '../store/applicationsStore';
import {
  getRecruitingMessages,
  addRecruitingMessage,
  getRecruitingThread,
  getRecruitingThreads,
  startRecruitingChat,
  loadMessagesForThread,
} from '../store/recruitingChats';
import { getAgencyById, type Agency } from '../services/agenciesSupabase';
import { ScreenScrollView } from '../components/ScreenScrollView';

type HeightFilter = 'all' | 'short' | 'medium' | 'tall';

function filterApplications(
  list: ModelApplication[],
  heightFilter: HeightFilter,
  minHeight: number | null,
  maxHeight: number | null,
  genderFilter: Gender | '',
  hairFilter: string,
  cityFilter: string
): ModelApplication[] {
  return list.filter((a) => {
    const h = a.height ?? 0;
    if (typeof minHeight === 'number' && !Number.isNaN(minHeight) && h < minHeight) return false;
    if (typeof maxHeight === 'number' && !Number.isNaN(maxHeight) && h > maxHeight) return false;
    if (heightFilter !== 'all') {
      if (heightFilter === 'short' && h >= 175) return false;
      if (heightFilter === 'medium' && (h < 175 || h > 182)) return false;
      if (heightFilter === 'tall' && h <= 182) return false;
    }
    if (genderFilter && (a.gender ?? '') !== genderFilter) return false;
    if (hairFilter && !((a.hairColor ?? '').toLowerCase().includes(hairFilter.toLowerCase()))) return false;
    if (cityFilter && !(a.city || '').toLowerCase().includes(cityFilter.toLowerCase())) return false;
    return true;
  });
}

export const AgencyRecruitingView: React.FC<{ onBack: () => void; agencyId: string }> = ({ onBack, agencyId }) => {
  const [recruitTab, setRecruitTab] = useState<'pending' | 'accepted'>('pending');
  const [allPending, setAllPending] = useState<ModelApplication[]>([]);
  const [heightFilter, setHeightFilter] = useState<HeightFilter>('all');
  const [minHeight, setMinHeight] = useState<string>('');
  const [maxHeight, setMaxHeight] = useState<string>('');
  const [genderFilter, setGenderFilter] = useState<Gender | ''>('');
  const [hairFilter, setHairFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [chatThreadId, setChatThreadId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [showBookingChats, setShowBookingChats] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [myAgency, setMyAgency] = useState<Agency | null>(null);

  useEffect(() => {
    if (!agencyId) {
      setMyAgency(null);
      return;
    }
    getAgencyById(agencyId).then(setMyAgency);
  }, [agencyId]);

  const applications = filterApplications(
    allPending,
    heightFilter,
    minHeight ? Number(minHeight) : null,
    maxHeight ? Number(maxHeight) : null,
    genderFilter,
    hairFilter,
    cityFilter
  );
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
      showFeedback('Active contract: model is in My Models. Chat is open.');
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
    setShowDetailModal(false);
    if (index >= applications.length - 1) setIndex((i) => Math.max(0, i - 1));
  };

  const handleStartChat = async () => {
    if (!current || !agencyId) return;
    setStartingChat(true);
    const modelName = `${current.firstName} ${current.lastName}`.trim();
    const threadId = await startRecruitingChat(current.id, modelName);
    setStartingChat(false);
    if (threadId) {
      await refreshApplications();
      setAllPending(getPendingApplications());
      setShowDetailModal(false);
      setChatThreadId(threadId);
      showFeedback('Chat started. You can message the model.');
    } else {
      showFeedback('Could not start chat. Try again.');
    }
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

  useEffect(() => {
    if (chatThreadId) loadMessagesForThread(chatThreadId);
  }, [chatThreadId]);

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
        </ScreenScrollView>
      ) : (
      <ScreenScrollView contentStyle={{ paddingHorizontal: spacing.lg }}>

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
          <View style={styles.heightRangeRow}>
            <Text style={styles.filterLabel}>Height range (cm)</Text>
            <View style={styles.heightInputsRow}>
              <TextInput
                value={minHeight}
                onChangeText={setMinHeight}
                placeholder="Min"
                keyboardType="number-pad"
                style={styles.heightInput}
              />
              <Text style={styles.heightDash}>–</Text>
              <TextInput
                value={maxHeight}
                onChangeText={setMaxHeight}
                placeholder="Max"
                keyboardType="number-pad"
                style={styles.heightInput}
              />
            </View>
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
          <Text style={styles.filterLabel}>City search</Text>
          <TextInput
            value={cityFilter}
            onChangeText={setCityFilter}
            placeholder="Search by city"
            placeholderTextColor={colors.textSecondary}
            style={styles.citySearchInput}
          />
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
            <TouchableOpacity
              style={styles.cardImageWrap}
              activeOpacity={1}
              onPress={() => setShowDetailModal(true)}
            >
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
                  {current.age} · {current.height} cm · {current.city || '—'}
                </Text>
                {current.instagramLink ? (
                  <Text style={styles.cardMeta} numberOfLines={1}>{current.instagramLink}</Text>
                ) : null}
                <Text style={[styles.cardMeta, { marginTop: 4, fontSize: 11, opacity: 0.9 }]}>Tap for full details</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.buttonNo} onPress={handleNo}>
                <Text style={styles.buttonNoLabel}>No</Text>
              </TouchableOpacity>
              {current.chatThreadId ? (
                <TouchableOpacity
                  style={[styles.buttonYes, { backgroundColor: colors.textPrimary }]}
                  onPress={() => setChatThreadId(current.chatThreadId!)}
                >
                  <Text style={styles.buttonYesLabel}>Open chat</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.buttonYes} onPress={handleYes}>
                  <Text style={styles.buttonYesLabel}>Add to selection</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No pending applications</Text>
          <Text style={styles.emptyCopy}>New applications will appear here.</Text>
        </View>
      )}

      </ScreenScrollView>
      )}

      {feedback && (
        <View style={styles.feedbackBanner}>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>
      )}

      <Modal visible={showDetailModal && !!current} transparent animationType="fade" onRequestClose={() => setShowDetailModal(false)}>
        <View style={styles.chatOverlay}>
          <View style={[styles.chatCard, { maxHeight: '90%' }]}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle}>{current ? `${current.firstName} ${current.lastName}` : 'Details'}</Text>
              <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                <Text style={styles.closeLabel}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {current && (
                <>
                  <View style={styles.filterLabel}>Photos</View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginBottom: spacing.md }}
                  >
                    {[current.images?.closeUp, current.images?.fullBody, current.images?.profile]
                      .filter(Boolean)
                      .map((uri, i) => (
                        <View key={i} style={{ marginRight: spacing.sm }}>
                          <Image
                            source={{ uri: uri! }}
                            style={{ width: 120, height: 150, borderRadius: 8, backgroundColor: colors.border }}
                            resizeMode="cover"
                          />
                        </View>
                      ))}
                    {(!current.images?.closeUp && !current.images?.fullBody && !current.images?.profile) && (
                      <Text style={styles.cardMeta}>No photos</Text>
                    )}
                  </ScrollView>
                  <View style={styles.filterLabel}>Details</View>
                  <Text style={styles.cardMeta}>Age: {current.age}</Text>
                  <Text style={styles.cardMeta}>Height: {current.height} cm</Text>
                  <Text style={styles.cardMeta}>Gender: {current.gender || '—'}</Text>
                  <Text style={styles.cardMeta}>Hair: {current.hairColor || '—'}</Text>
                  <Text style={styles.cardMeta}>City: {current.city || '—'}</Text>
                  <Text style={styles.cardMeta}>Instagram: {current.instagramLink || '—'}</Text>
                </>
              )}
            </ScrollView>
            {current && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.md }}>
                {!current.chatThreadId && (
                  <TouchableOpacity
                    style={[styles.filterPill, { paddingHorizontal: spacing.md, paddingVertical: spacing.sm }]}
                    onPress={handleStartChat}
                    disabled={startingChat}
                  >
                    <Text style={styles.filterPillText}>{startingChat ? 'Starting…' : 'Start chat'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.buttonYes, { flex: 1, minWidth: 120 }]} onPress={() => { setShowDetailModal(false); handleYes(); }}>
                  <Text style={styles.buttonYesLabel}>Add to selection</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.buttonNo, { flex: 1, minWidth: 100 }]} onPress={handleNo}>
                  <Text style={styles.buttonNoLabel}>Decline</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!chatThreadId}
        transparent
        animationType="fade"
        onRequestClose={closeChat}
      >
        <View style={styles.chatOverlay}>
          <View style={styles.chatCard}>
            <View style={styles.chatHeader}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {myAgency?.logo_url ? (
                  <Image source={{ uri: myAgency.logo_url }} style={styles.chatAgencyLogo} resizeMode="contain" />
                ) : myAgency ? (
                  <View style={styles.chatAgencyLogoPlaceholder}>
                    <Text style={styles.chatAgencyLogoLetter}>{(myAgency.name || '?').charAt(0).toUpperCase()}</Text>
                  </View>
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={styles.chatAgencyName}>{myAgency?.name ?? 'Agency'}</Text>
                  <Text style={styles.chatTitle}>
                    {thread ? `Applicant: ${thread.modelName}` : 'Chat'}
                  </Text>
                </View>
              </View>
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
  chatAgencyLogo: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  chatAgencyLogoPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatAgencyLogoLetter: {
    ...typography.heading,
    fontSize: 16,
    color: colors.surface,
  },
  chatAgencyName: {
    ...typography.heading,
    fontSize: 14,
    color: colors.textPrimary,
  },
  chatTitle: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
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
  heightRangeRow: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  heightInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heightInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
  },
  heightDash: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
  },
  citySearchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
});


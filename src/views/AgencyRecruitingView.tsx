/**
 * Agency recruiting: swipe queue (pending), shortlist, accepted; recruiting chat threads in Supabase.
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
  getPendingSwipeQueueApplications,
  getAcceptedApplications,
  acceptApplication,
  rejectApplication,
  refreshApplications,
  subscribeApplications,
  getApplicationById,
  type ModelApplication,
  type Gender,
} from '../store/applicationsStore';
import { tryStartRecruitingChat } from '../store/recruitingChats';
import { loadAgencyShortlistIds, saveAgencyShortlistIds } from '../storage/agencyRecruitingShortlist';

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

export const AgencyRecruitingView: React.FC<{
  onBack: () => void;
  agencyId: string;
  /** Opens recruiting chat (modal); threads are stored in Supabase for agency and model. */
  onOpenBookingChat: (threadId: string) => void;
}> = ({ onBack, agencyId, onOpenBookingChat }) => {
  const [recruitTab, setRecruitTab] = useState<'pending' | 'shortlist' | 'accepted'>('pending');
  /** All pending apps without a recruiting thread (from store). */
  const [allSwipeQueue, setAllSwipeQueue] = useState<ModelApplication[]>([]);
  const [heightFilter, setHeightFilter] = useState<HeightFilter>('all');
  const [minHeight, setMinHeight] = useState<string>('');
  const [maxHeight, setMaxHeight] = useState<string>('');
  const [genderFilter, setGenderFilter] = useState<Gender | ''>('');
  const [hairFilter, setHairFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** Application shown in the details modal (pending card or shortlist). */
  const [detailApplication, setDetailApplication] = useState<ModelApplication | null>(null);
  const [startingChat, setStartingChat] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [showPhotoFullscreen, setShowPhotoFullscreen] = useState(false);
  const [shortlistIds, setShortlistIds] = useState<string[]>([]);

  const shortlistSet = React.useMemo(() => new Set(shortlistIds), [shortlistIds]);
  /** Pending swipe queue excludes shortlist so those models only appear under My list. */
  const pendingNotShortlisted = React.useMemo(
    () => allSwipeQueue.filter((a) => !shortlistSet.has(a.id)),
    [allSwipeQueue, shortlistSet]
  );

  const applications = filterApplications(
    pendingNotShortlisted,
    heightFilter,
    minHeight ? Number(minHeight) : null,
    maxHeight ? Number(maxHeight) : null,
    genderFilter,
    hairFilter,
    cityFilter
  );
  const current = applications[index] ?? null;

  const filteredFromStore = () =>
    filterApplications(
      getPendingSwipeQueueApplications().filter((a) => !shortlistSet.has(a.id)),
      heightFilter,
      minHeight ? Number(minHeight) : null,
      maxHeight ? Number(maxHeight) : null,
      genderFilter,
      hairFilter,
      cityFilter
    );
  const acceptedList = getAcceptedApplications();
  const shortlistApps = shortlistIds
    .map((id) => getApplicationById(id))
    .filter((a): a is ModelApplication => !!a && a.status !== 'rejected');
  const uniqueCities = React.useMemo(
    () => Array.from(new Set(allSwipeQueue.map((a) => a.city).filter(Boolean))).sort(),
    [allSwipeQueue]
  );
  const uniqueHair = React.useMemo(
    () => Array.from(new Set(allSwipeQueue.map((a) => a.hairColor).filter(Boolean))).sort(),
    [allSwipeQueue]
  );

  const refreshSwipeQueue = () => setAllSwipeQueue(getPendingSwipeQueueApplications());

  useEffect(() => {
    refreshSwipeQueue();
    const unsub = subscribeApplications(() => refreshSwipeQueue());
    return unsub;
  }, []);

  useEffect(() => {
    if (!agencyId) {
      setShortlistIds([]);
      return;
    }
    loadAgencyShortlistIds(agencyId).then(setShortlistIds);
  }, [agencyId]);

  useEffect(() => {
    setIndex((i) => (i >= applications.length ? Math.max(0, applications.length - 1) : i));
  }, [applications.length]);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleAcceptForApp = async (app: ModelApplication) => {
    if (!agencyId) return;
    const threadId = await acceptApplication(app.id, agencyId);
    if (threadId) {
      showFeedback('Model accepted. Open the thread under Booking chats → Recruiting chats.');
      onOpenBookingChat(threadId);
      refreshSwipeQueue();
      setDetailApplication(null);
      setShortlistIds((prev) => {
        if (!prev.includes(app.id)) return prev;
        const next = prev.filter((id) => id !== app.id);
        void saveAgencyShortlistIds(agencyId, next);
        return next;
      });
      setIndex((prev) => {
        const apps = filteredFromStore();
        if (apps.length === 0) return 0;
        return Math.min(prev, apps.length - 1);
      });
    }
  };

  const handleYes = () => {
    if (current) void handleAcceptForApp(current);
  };

  const handleDeclineForApp = async (app: ModelApplication) => {
    await rejectApplication(app.id);
    showFeedback('Application declined (archived).');
    refreshSwipeQueue();
    setDetailApplication(null);
    setShortlistIds((prev) => {
      if (!agencyId || !prev.includes(app.id)) return prev;
      const next = prev.filter((id) => id !== app.id);
      void saveAgencyShortlistIds(agencyId, next);
      return next;
    });
    if (current?.id === app.id && index >= applications.length - 1) {
      setIndex((i) => Math.max(0, i - 1));
    }
  };

  const handleNo = () => {
    if (current) void handleDeclineForApp(current);
  };

  const handleAddToList = () => {
    if (!current || !agencyId) return;
    setShortlistIds((prev) => {
      const next = prev.includes(current.id) ? prev : [...prev, current.id];
      void saveAgencyShortlistIds(agencyId, next);
      return next;
    });
    showFeedback('Saved to My list.');
    setRecruitTab('shortlist');
    if (index >= applications.length - 1) {
      setIndex((i) => Math.max(0, i - 1));
    } else {
      setIndex((i) => i + 1);
    }
  };

  const handleStartChatForApp = async (app: ModelApplication) => {
    if (!agencyId) return;
    setStartingChat(true);
    const modelName = `${app.firstName} ${app.lastName}`.trim();
    const chatResult = await tryStartRecruitingChat(app.id, modelName, agencyId);
    setStartingChat(false);
    if (chatResult.ok) {
      await refreshApplications();
      refreshSwipeQueue();
      setDetailApplication(null);
      onOpenBookingChat(chatResult.threadId);
      showFeedback('Chat ready. Continue under Booking chats → Recruiting chats.');
      setIndex((prev) => {
        const apps = filteredFromStore();
        if (apps.length <= 1) return 0;
        return Math.min(prev, apps.length - 1);
      });
    } else {
      showFeedback(chatResult.messageDe);
    }
  };

  const handleRemoveFromShortlist = (applicationId: string) => {
    if (!agencyId) return;
    setShortlistIds((prev) => {
      const next = prev.filter((id) => id !== applicationId);
      void saveAgencyShortlistIds(agencyId, next);
      return next;
    });
    showFeedback('Removed from list.');
  };

  const openApplicationDetails = (app: ModelApplication) => {
    setDetailApplication(app);
    setPhotoIndex(0);
    setShowPhotoFullscreen(false);
  };

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

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {(['pending', 'shortlist', 'accepted'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.filterPill, recruitTab === t && styles.filterPillActive]}
            onPress={() => setRecruitTab(t)}
          >
            <Text style={[styles.filterPillText, recruitTab === t && styles.filterPillTextActive]}>
              {t === 'pending'
                ? `Pending (${applications.length})`
                : t === 'shortlist'
                  ? `My list (${shortlistIds.length})`
                  : `Accepted (${acceptedList.length})`}
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
                <TouchableOpacity style={styles.bookingChatOpen} onPress={() => app.chatThreadId && onOpenBookingChat(app.chatThreadId)}>
                  <Text style={styles.bookingChatOpenLabel}>Chat</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      ) : recruitTab === 'shortlist' ? (
        <ScrollView style={{ flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md }} contentContainerStyle={{ paddingBottom: spacing.xl }}>
          <Text style={[styles.filterLabel, { marginBottom: spacing.sm }]}>
            Saved for this agency only. Open details to see full application data.
          </Text>
          {shortlistIds.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Your list is empty</Text>
              <Text style={styles.emptyCopy}>Under Pending, tap Add to list on a candidate.</Text>
            </View>
          ) : shortlistApps.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No entries left</Text>
              <Text style={styles.emptyCopy}>Applications were archived or removed.</Text>
            </View>
          ) : (
            shortlistApps.map((app) => {
              const thumbUri = app.images?.closeUp || app.images?.profile || app.images?.fullBody;
              return (
                <View key={app.id} style={styles.bookingChatRow}>
                  <TouchableOpacity style={styles.bookingChatThumbWrap} onPress={() => openApplicationDetails(app)} activeOpacity={0.85}>
                    {thumbUri ? (
                      <Image source={{ uri: thumbUri }} style={styles.bookingChatThumb} resizeMode="contain" />
                    ) : (
                      <View style={[styles.bookingChatThumb, styles.bookingChatThumbPlaceholder]}>
                        <Text style={styles.bookingChatThumbPlaceholderText} numberOfLines={1}>
                          {app.firstName} {app.lastName}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  <View style={{ flex: 1, marginLeft: spacing.sm }}>
                    <Text style={styles.bookingChatName}>
                      {app.firstName} {app.lastName}
                    </Text>
                    <Text style={styles.shortlistRowSub}>{app.city || '—'} · {app.height} cm</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.filterPill, { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }]}
                    onPress={() => openApplicationDetails(app)}
                  >
                    <Text style={styles.filterPillText}>Details</Text>
                  </TouchableOpacity>
                  {app.chatThreadId ? (
                    <TouchableOpacity style={styles.bookingChatOpen} onPress={() => onOpenBookingChat(app.chatThreadId!)}>
                      <Text style={styles.bookingChatOpenLabel}>Chat</Text>
                    </TouchableOpacity>
                  ) : app.status === 'pending' ? (
                    <TouchableOpacity
                      style={styles.bookingChatOpen}
                      onPress={() => void handleStartChatForApp(app)}
                      disabled={startingChat}
                    >
                      <Text style={styles.bookingChatOpenLabel}>{startingChat ? '…' : 'Start chat'}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.buttonNo, { marginLeft: spacing.xs, paddingHorizontal: spacing.sm }]}
                    onPress={() => handleRemoveFromShortlist(app.id)}
                  >
                    <Text style={styles.buttonNoLabel}>Remove</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      ) : (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xl }} showsVerticalScrollIndicator={false}>
      <TouchableOpacity style={styles.filterToggle} onPress={() => setFilterOpen((o) => !o)}>
        <Text style={styles.filterToggleLabel}>Filters</Text>
        <Text style={styles.filterToggleArrow}>{filterOpen ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      {filterOpen && (
        <View style={[styles.filterRow, { marginBottom: spacing.md }]}>
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

      <View style={{ height: 8 }} />

      {current ? (
        <View style={styles.cardWrap}>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.cardImageWrap}
              activeOpacity={1}
              onPress={() => current && openApplicationDetails(current)}
            >
              {(current.images?.closeUp || current.images?.fullBody || current.images?.profile) ? (
                <Image
                  source={{ uri: current.images.closeUp || current.images.fullBody || current.images.profile }}
                  style={styles.cardImage}
                  resizeMode="contain"
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
                <Text style={[styles.cardMeta, { marginTop: 4, fontSize: 11, opacity: 0.9 }]}>Tap for application details</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.cardActions}>
              <View style={styles.cardActionsRowCentered}>
                <TouchableOpacity style={styles.buttonAccept} onPress={handleYes}>
                  <Text style={styles.buttonAcceptLabel}>Accept application</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.cardActionsRow}>
                <TouchableOpacity style={styles.buttonNo} onPress={handleNo}>
                  <Text style={styles.buttonNoLabel}>No</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.buttonSecondary} onPress={handleAddToList}>
                  <Text style={styles.buttonSecondaryLabel}>Add to List</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No pending applications</Text>
          <Text style={styles.emptyCopy}>New applications will appear here.</Text>
        </View>
      )}

      </ScrollView>
      )}

      {feedback && (
        <View style={styles.feedbackBanner}>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>
      )}

      <Modal visible={!!detailApplication} transparent animationType="fade" onRequestClose={() => setDetailApplication(null)}>
        <View style={styles.chatOverlay}>
          <View style={[styles.chatCard, { maxHeight: '90%' }]}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle}>
                {detailApplication ? `${detailApplication.firstName} ${detailApplication.lastName}` : 'Details'}
              </Text>
              <TouchableOpacity onPress={() => setDetailApplication(null)}>
                <Text style={styles.closeLabel}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {detailApplication && (
                <>
                  <Text style={styles.detailSectionLabel}>Photos</Text>
                  {(() => {
                    const d = detailApplication;
                    const uris = [d.images?.closeUp, d.images?.fullBody, d.images?.profile].filter(Boolean) as string[];
                    const idx = Math.min(photoIndex, Math.max(0, uris.length - 1));
                    const uri = uris[idx];
                    return (
                      <View style={styles.photoSwipeWrap}>
                        {uris.length > 1 && (
                          <TouchableOpacity
                            style={styles.photoSwipeArrow}
                            onPress={() => setPhotoIndex((i) => Math.max(0, i - 1))}
                            disabled={idx <= 0}
                          >
                            <Text style={[styles.photoSwipeArrowText, idx <= 0 && styles.photoSwipeArrowDisabled]}>◀</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.photoSwipeImageWrap}
                          onPress={() => uri && setShowPhotoFullscreen(true)}
                          activeOpacity={1}
                        >
                          {uri ? (
                            <Image source={{ uri }} style={styles.photoSwipeImage} resizeMode="contain" />
                          ) : (
                            <View style={[styles.photoSwipeImage, styles.detailPhotoPlaceholder]}>
                              <Text style={styles.detailBodyMuted}>No photo</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                        {uris.length > 1 && (
                          <TouchableOpacity
                            style={styles.photoSwipeArrow}
                            onPress={() => setPhotoIndex((i) => Math.min(uris.length - 1, i + 1))}
                            disabled={idx >= uris.length - 1}
                          >
                            <Text style={[styles.photoSwipeArrowText, idx >= uris.length - 1 && styles.photoSwipeArrowDisabled]}>▶</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })()}
                  <Text style={styles.detailHint}>Tap image to enlarge · Use arrows to browse photos</Text>
                  <Text style={styles.detailSectionLabel}>Application details</Text>
                  <Text style={styles.detailBody}>Age: {detailApplication.age}</Text>
                  <Text style={styles.detailBody}>Height: {detailApplication.height} cm</Text>
                  <Text style={styles.detailBody}>Gender: {detailApplication.gender || '—'}</Text>
                  <Text style={styles.detailBody}>Hair color: {detailApplication.hairColor || '—'}</Text>
                  <Text style={styles.detailBody}>City: {detailApplication.city || '—'}</Text>
                  <Text style={styles.detailBody}>Instagram: {detailApplication.instagramLink || '—'}</Text>
                </>
              )}
            </ScrollView>
            {detailApplication && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.md }}>
                {!detailApplication.chatThreadId && detailApplication.status === 'pending' && (
                  <TouchableOpacity
                    style={[styles.filterPill, { paddingHorizontal: spacing.md, paddingVertical: spacing.sm }]}
                    onPress={() => void handleStartChatForApp(detailApplication)}
                    disabled={startingChat}
                  >
                    <Text style={styles.filterPillText}>{startingChat ? 'Starting…' : 'Start chat'}</Text>
                  </TouchableOpacity>
                )}
                {detailApplication.status === 'pending' && (
                  <>
                    <TouchableOpacity
                      style={[styles.buttonYes, { flex: 1, minWidth: 120 }]}
                      onPress={() => void handleAcceptForApp(detailApplication)}
                    >
                      <Text style={styles.buttonYesLabel}>Accept application</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.buttonNo, { flex: 1, minWidth: 100 }]}
                      onPress={() => void handleDeclineForApp(detailApplication)}
                    >
                      <Text style={styles.buttonNoLabel}>Decline</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showPhotoFullscreen && !!detailApplication} transparent animationType="fade" onRequestClose={() => setShowPhotoFullscreen(false)}>
        <TouchableOpacity style={styles.fullscreenPhotoOverlay} activeOpacity={1} onPress={() => setShowPhotoFullscreen(false)}>
          {detailApplication && (() => {
            const uris = [detailApplication.images?.closeUp, detailApplication.images?.fullBody, detailApplication.images?.profile].filter(Boolean) as string[];
            const uri = uris[Math.min(photoIndex, Math.max(0, uris.length - 1))];
            return uri ? <Image source={{ uri }} style={styles.fullscreenPhoto} resizeMode="contain" /> : null;
          })()}
          <Text style={styles.fullscreenPhotoHint}>Tap to close</Text>
        </TouchableOpacity>
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
  shortlistRowSub: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  detailSectionLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  detailBody: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  detailBodyMuted: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
  detailHint: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  detailPhotoPlaceholder: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
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
  bookingChatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  bookingChatThumbWrap: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  bookingChatThumb: {
    width: '100%',
    height: '100%',
  },
  bookingChatThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookingChatThumbPlaceholderText: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  bookingChatName: {
    flex: 1,
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
    padding: spacing.md,
    gap: spacing.md,
  },
  cardActionsRowCentered: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  buttonAccept: {
    flex: 1,
    maxWidth: 320,
    borderRadius: 999,
    backgroundColor: colors.buttonOptionGreen,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonAcceptLabel: {
    ...typography.label,
    color: colors.surface,
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
  buttonSecondary: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondaryLabel: {
    ...typography.label,
    color: colors.textPrimary,
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
  chatTitle: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    flex: 1,
  },
  closeLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
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
  photoSwipeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  photoSwipeArrow: {
    padding: spacing.sm,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoSwipeArrowText: {
    fontSize: 24,
    color: colors.textPrimary,
  },
  photoSwipeArrowDisabled: {
    opacity: 0.3,
  },
  photoSwipeImageWrap: {
    flex: 1,
    minHeight: 200,
  },
  photoSwipeImage: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    backgroundColor: colors.border,
  },
  fullscreenPhotoOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenPhoto: {
    width: '100%',
    height: '80%',
  },
  fullscreenPhotoHint: {
    position: 'absolute',
    bottom: spacing.xl,
    ...typography.label,
    color: 'rgba(255,255,255,0.7)',
  },
});


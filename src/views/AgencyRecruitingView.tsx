/**
 * Agency recruiting: swipe queue (pending), shortlist, accepted; recruiting chat threads in Supabase.
 */
import React, { useEffect, useState, useMemo } from 'react';
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
import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';
import { colors, spacing, typography } from '../theme/theme';
import {
  getApplications,
  getPendingSwipeQueueApplications,
  getAcceptedApplications,
  acceptApplication,
  rejectApplication,
  refreshApplications,
  subscribeApplications,
  getApplicationById,
  type ModelApplication,
} from '../store/applicationsStore';
import { tryStartRecruitingChat } from '../store/recruitingChats';
import { loadAgencyShortlistIds, saveAgencyShortlistIds } from '../storage/agencyRecruitingShortlist';
import { mergeAgencyRecruitingMyListIds } from '../utils/agencyRecruitingMyList';
import { upsertTerritoriesForModel } from '../services/territoriesSupabase';
import {
  getMyAgencyUsageLimits,
  incrementMyAgencySwipeCount,
  type AgencyUsageLimits,
} from '../services/agencyUsageLimitsSupabase';
import { uiCopy } from '../constants/uiCopy';
import ModelFiltersPanel from '../components/ModelFiltersPanel';
import {
  defaultModelFilters,
  filterApplicationsByModelFilters,
  FILTER_COUNTRIES,
  type ModelFilters,
} from '../utils/modelFilters';

countries.registerLocale(enLocale);
const ISO_COUNTRY_NAMES: Record<string, string> = countries.getNames('en', {
  select: 'official',
}) as Record<string, string>;
const ISO_COUNTRY_LIST = Object.entries(ISO_COUNTRY_NAMES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));


export const AgencyRecruitingView: React.FC<{
  onBack: () => void;
  agencyId: string;
  /** Opens recruiting chat (modal); threads are stored in Supabase for agency and model. */
  onOpenBookingChat: (threadId: string) => void;
}> = ({ onBack, agencyId, onOpenBookingChat }) => {
  const [recruitTab, setRecruitTab] = useState<'pending' | 'shortlist' | 'accepted'>('pending');
  /** All pending apps without a recruiting thread (from store). */
  const [allSwipeQueue, setAllSwipeQueue] = useState<ModelApplication[]>([]);
  const [filters, setFilters] = useState<ModelFilters>(defaultModelFilters);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** Application shown in the details modal (pending card or shortlist). */
  const [detailApplication, setDetailApplication] = useState<ModelApplication | null>(null);
  const [startingChat, setStartingChat] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [showPhotoFullscreen, setShowPhotoFullscreen] = useState(false);
  const [shortlistIds, setShortlistIds] = useState<string[]>([]);
  /** Pending applications with an active recruiting thread (same rows as Messages → Recruiting chats). */
  const [pendingWithChatApps, setPendingWithChatApps] = useState<ModelApplication[]>([]);

  /** Organisation-wide daily swipe usage. Loaded once on mount and updated locally after each action. */
  const [usageLimits, setUsageLimits] = useState<AgencyUsageLimits | null>(null);

  const isLimitReached =
    usageLimits !== null && usageLimits.swipes_used_today >= usageLimits.daily_swipe_limit;

  // Territory modal state (shown before accept)
  const [pendingAcceptApp, setPendingAcceptApp] = useState<ModelApplication | null>(null);
  const [selectedCountryCodes, setSelectedCountryCodes] = useState<string[]>([]);
  const [territorySearch, setTerritorySearch] = useState('');
  const [acceptingWithTerritories, setAcceptingWithTerritories] = useState(false);

  const filteredCountries = useMemo(() => {
    const q = territorySearch.trim().toLowerCase();
    if (!q) return ISO_COUNTRY_LIST;
    return ISO_COUNTRY_LIST.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [territorySearch]);

  const shortlistSet = React.useMemo(() => new Set(shortlistIds), [shortlistIds]);
  /** Pending swipe queue excludes shortlist so those models only appear under My list. */
  const pendingNotShortlisted = React.useMemo(
    () => allSwipeQueue.filter((a) => !shortlistSet.has(a.id)),
    [allSwipeQueue, shortlistSet]
  );

  const applications = filterApplicationsByModelFilters(pendingNotShortlisted, filters);
  const current = applications[index] ?? null;

  const filteredFromStore = () =>
    filterApplicationsByModelFilters(
      getPendingSwipeQueueApplications().filter((a) => !shortlistSet.has(a.id)),
      filters,
    );
  const acceptedList = getAcceptedApplications();
  /** My list = explicit shortlist ∪ every pending application that already has a recruiting chat (always in sync with Messages → Recruiting chats). */
  const mergedMyListIds = React.useMemo(
    () =>
      mergeAgencyRecruitingMyListIds(
        shortlistIds,
        pendingWithChatApps.map((a) => a.id)
      ),
    [shortlistIds, pendingWithChatApps]
  );

  const shortlistApps = mergedMyListIds
    .map((id) => getApplicationById(id))
    .filter((a): a is ModelApplication => !!a && a.status !== 'rejected');
  const refreshSwipeQueue = () => {
    setAllSwipeQueue(getPendingSwipeQueueApplications());
    setPendingWithChatApps(
      getApplications().filter((a) => a.status === 'pending' && !!a.chatThreadId)
    );
  };

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
    getMyAgencyUsageLimits().then(setUsageLimits);
  }, [agencyId]);

  useEffect(() => {
    setIndex((i) => (i >= applications.length ? Math.max(0, applications.length - 1) : i));
  }, [applications.length]);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  };

  /** Step 1: open territory modal; actual accept happens in handleConfirmAcceptWithTerritories */
  const handleAcceptForApp = (app: ModelApplication) => {
    if (!agencyId) return;
    setPendingAcceptApp(app);
    setSelectedCountryCodes([]);
    setTerritorySearch('');
  };

  /** Step 2: agency confirmed territories → accept + assign */
  const handleConfirmAcceptWithTerritories = async () => {
    if (!agencyId || !pendingAcceptApp) return;
    if (selectedCountryCodes.length === 0) {
      showFeedback(uiCopy.territoryModal.requiredHint);
      return;
    }
    setAcceptingWithTerritories(true);
    const result = await acceptApplication(pendingAcceptApp.id, agencyId);
    if (result) {
      if (result.modelId) {
        await upsertTerritoriesForModel(result.modelId, agencyId, selectedCountryCodes);
      }
      setPendingAcceptApp(null);
      showFeedback('Model accepted. Open the thread under Messages → Recruiting chats.');
      onOpenBookingChat(result.threadId);
      refreshSwipeQueue();
      setDetailApplication(null);
      setShortlistIds((prev) => {
        if (!prev.includes(pendingAcceptApp.id)) return prev;
        const next = prev.filter((id) => id !== pendingAcceptApp.id);
        void saveAgencyShortlistIds(agencyId, next);
        return next;
      });
      setIndex((prev) => {
        const apps = filteredFromStore();
        if (apps.length === 0) return 0;
        return Math.min(prev, apps.length - 1);
      });
    } else {
      showFeedback('Could not accept application. Please try again.');
    }
    setAcceptingWithTerritories(false);
  };

  const handleYes = async () => {
    if (!current) return;
    const result = await incrementMyAgencySwipeCount();
    setUsageLimits((prev) =>
      prev ? { ...prev, swipes_used_today: result.swipes_used, daily_swipe_limit: result.limit } : prev,
    );
    if (!result.allowed) {
      showFeedback(uiCopy.recruiting.limitReachedMessage);
      return;
    }
    handleAcceptForApp(current);
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

  const handleNo = async () => {
    if (!current) return;
    const result = await incrementMyAgencySwipeCount();
    setUsageLimits((prev) =>
      prev ? { ...prev, swipes_used_today: result.swipes_used, daily_swipe_limit: result.limit } : prev,
    );
    if (!result.allowed) {
      showFeedback(uiCopy.recruiting.limitReachedMessage);
      return;
    }
    void handleDeclineForApp(current);
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
      showFeedback('Chat ready. Continue under Messages → Recruiting chats.');
      setIndex((prev) => {
        const apps = filteredFromStore();
        if (apps.length <= 1) return 0;
        return Math.min(prev, apps.length - 1);
      });
    } else {
      showFeedback(chatResult.message);
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
                  ? `My list (${mergedMyListIds.length})`
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
            Includes everyone you saved and everyone with an active recruiting chat (same as Messages → Recruiting chats, before acceptance).
          </Text>
          {mergedMyListIds.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Your list is empty</Text>
              <Text style={styles.emptyCopy}>Under Pending, tap Add to list, or start a chat — candidates stay here until accepted.</Text>
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
                  {shortlistIds.includes(app.id) ? (
                    <TouchableOpacity
                      style={[styles.buttonNo, { marginLeft: spacing.xs, paddingHorizontal: spacing.sm }]}
                      onPress={() => handleRemoveFromShortlist(app.id)}
                    >
                      <Text style={styles.buttonNoLabel}>Remove</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={[styles.shortlistRowSub, { marginLeft: spacing.xs }]}>In chat</Text>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      ) : (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xl }} showsVerticalScrollIndicator={false}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <ModelFiltersPanel filters={filters} onChangeFilters={setFilters} />
      </View>

      <View style={{ height: 8 }} />

      {usageLimits && (
        <View style={styles.swipeCounterRow}>
          <Text style={styles.swipeCounterText}>
            {uiCopy.recruiting.dailySwipeCounter(
              usageLimits.swipes_used_today,
              usageLimits.daily_swipe_limit,
            )}
          </Text>
        </View>
      )}

      {isLimitReached && (
        <View style={styles.limitBanner}>
          <Text style={styles.limitBannerText}>{uiCopy.recruiting.limitReachedMessage}</Text>
          <Text style={styles.limitBannerCTA}>{uiCopy.recruiting.upgradeCTA}</Text>
        </View>
      )}

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
                <TouchableOpacity
                  style={[styles.buttonAccept, isLimitReached && styles.buttonDisabled]}
                  onPress={() => void handleYes()}
                  disabled={isLimitReached}
                >
                  <Text style={styles.buttonAcceptLabel}>Accept application</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.cardActionsRow}>
                <TouchableOpacity
                  style={[styles.buttonNo, isLimitReached && styles.buttonDisabled]}
                  onPress={() => void handleNo()}
                  disabled={isLimitReached}
                >
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
                  <Text style={styles.detailBody}>
                    Country: {detailApplication.countryCode
                      ? (FILTER_COUNTRIES.find((c) => c.code === detailApplication.countryCode)?.label ?? detailApplication.countryCode)
                      : '—'}
                  </Text>
                  <Text style={styles.detailBody}>Ethnicity: {detailApplication.ethnicity || '—'}</Text>
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
                      onPress={() => handleAcceptForApp(detailApplication)}
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

      {/* Territory selection modal — shown before accepting a model */}
      <Modal
        visible={!!pendingAcceptApp}
        transparent
        animationType="slide"
        onRequestClose={() => setPendingAcceptApp(null)}
      >
        <View style={styles.chatOverlay}>
          <View style={[styles.chatCard, { maxHeight: '90%' }]}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle}>{uiCopy.territoryModal.title}</Text>
              <TouchableOpacity onPress={() => setPendingAcceptApp(null)}>
                <Text style={styles.closeLabel}>{uiCopy.common.cancel}</Text>
              </TouchableOpacity>
            </View>

            {pendingAcceptApp && (
              <Text style={[styles.filterLabel, { marginBottom: spacing.sm }]}>
                {pendingAcceptApp.firstName} {pendingAcceptApp.lastName} · {uiCopy.territoryModal.subtitle}
              </Text>
            )}

            <TextInput
              value={territorySearch}
              onChangeText={setTerritorySearch}
              placeholder={uiCopy.territoryModal.searchPlaceholder}
              placeholderTextColor={colors.textSecondary}
              style={[styles.citySearchInput, { marginBottom: spacing.sm }]}
            />

            {selectedCountryCodes.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: spacing.sm }}>
                {selectedCountryCodes.map((code) => (
                  <TouchableOpacity
                    key={code}
                    style={styles.filterPillActive}
                    onPress={() =>
                      setSelectedCountryCodes((prev) => prev.filter((c) => c !== code))
                    }
                  >
                    <Text style={[styles.filterPillText, styles.filterPillTextActive]}>
                      {ISO_COUNTRY_NAMES[code] ?? code} ✕
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <ScrollView style={{ maxHeight: 260 }}>
              {filteredCountries.length === 0 ? (
                <Text style={styles.filterLabel}>{uiCopy.territoryModal.noCountriesFound}</Text>
              ) : (
                filteredCountries.map((c) => {
                  const active = selectedCountryCodes.includes(c.code);
                  return (
                    <TouchableOpacity
                      key={c.code}
                      style={[styles.territoryRow, active && styles.territoryRowActive]}
                      onPress={() =>
                        setSelectedCountryCodes((prev) =>
                          active ? prev.filter((x) => x !== c.code) : [...prev, c.code],
                        )
                      }
                    >
                      <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                        {c.name} ({c.code})
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            {selectedCountryCodes.length === 0 && (
              <Text style={[styles.filterLabel, { marginTop: spacing.sm, color: colors.buttonSkipRed }]}>
                {uiCopy.territoryModal.requiredHint}
              </Text>
            )}

            <TouchableOpacity
              style={[
                styles.buttonAccept,
                { marginTop: spacing.md },
                (selectedCountryCodes.length === 0 || acceptingWithTerritories) && { opacity: 0.4 },
              ]}
              onPress={handleConfirmAcceptWithTerritories}
              disabled={selectedCountryCodes.length === 0 || acceptingWithTerritories}
            >
              <Text style={styles.buttonAcceptLabel}>
                {acceptingWithTerritories ? 'Accepting…' : uiCopy.territoryModal.confirmButton}
              </Text>
            </TouchableOpacity>
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
  territoryRow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    marginBottom: 2,
  },
  territoryRowActive: {
    backgroundColor: colors.textPrimary,
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
  swipeCounterRow: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  swipeCounterText: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 12,
  },
  limitBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: '#FFF3CD',
    borderRadius: 10,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  limitBannerText: {
    ...typography.label,
    color: '#856404',
    textAlign: 'center',
    fontSize: 13,
  },
  limitBannerCTA: {
    ...typography.label,
    color: '#533f03',
    fontWeight: '700',
    fontSize: 13,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
});


import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Platform } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import {
  attentionSignalsFromOptionRequestLike,
  clientMayConfirmJobFromSignals,
  priceCommerciallySettledForUi,
} from '../../utils/optionRequestAttention';
import type { OptionRequest, ChatStatus } from '../../store/optionRequests';
import type { ClientAssignmentFlag, AssignmentFlagColor } from '../../services/clientAssignmentsSupabase';

export type NegotiationThreadFooterProps = {
  request: OptionRequest;
  isAgency: boolean;
  status: ChatStatus | null;
  finalStatus: OptionRequest['finalStatus'];
  clientPriceStatus: OptionRequest['clientPriceStatus'];
  currency: string;
  agencyCounterPrice: number | undefined;
  negotiationCounterExpanded: boolean;
  setNegotiationCounterExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  agencyCounterInput: string;
  setAgencyCounterInput: (s: string) => void;
  /** When true, primary agency action buttons are dimmed/disabled (e.g. multi-tab processing). */
  actionBusy?: boolean;
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>;
  assignableMembers: Array<{ userId: string; name: string }>;
  onSaveClientAssignment?: (
    clientOrganizationId: string,
    patch: { label: string; color: AssignmentFlagColor; assignedMemberUserId?: string | null },
  ) => Promise<void>;
  editingAssignmentThreadId: string | null;
  setEditingAssignmentThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  openOrgChatBusy: boolean;
  openOrgChatFromRequest: () => void;
  /** Agency: confirm AVAILABILITY only (Axis 2 — final_status). */
  onAgencyConfirmAvailability: () => Promise<void>;
  /** Agency: accept client's proposed PRICE only (Axis 1 — client_price_status). */
  onAgencyAcceptClientPrice: () => Promise<void>;
  onAgencyRejectClientPrice: () => Promise<void>;
  onAgencyCounterOffer: (amount: number) => Promise<void>;
  onAgencyProposeInitialFee: (amount: number) => Promise<void>;
  onRejectNegotiation: () => void;
  onClientAcceptCounter: () => Promise<void>;
  /** Decline agency counter-offer (closes request) — optional; omit on agency-only surfaces. */
  onClientRejectCounter?: () => Promise<void>;
  onClientConfirmJob: () => Promise<void>;
  /**
   * Agency native fullscreen: show proposed price line under org row + model-approval strip when the model is linked.
   * Client web keeps this off (prices/chips live in the header; linked-model strip was not shown there historically).
   */
  showAgencyExtras?: boolean;
  /** Client web: full assignment editor; agency app: one-line read-only when a flag exists. */
  assignmentMode?: 'manage' | 'readonly';
  /** First pill label next to "Open org chat" (agency thread copy vs. generic negotiation). */
  contextThreadLabel?: string;
  /** When true, org-chat button also requires `request.agencyId` (client web). Agency app passes false. */
  requireAgencyIdForOrgChat?: boolean;
  /**
   * When the summary card / chips already show price + status + model hints, hide repeated banners in the footer.
   */
  suppressDuplicateMeta?: boolean;
};

/**
 * Consolidated negotiation footer: assignment, org chat, model/final banners, agency/client CTAs + inline counter.
 * Availability (Axis 2) and Price (Axis 1) buttons are fully decoupled.
 */
export const NegotiationThreadFooter: React.FC<NegotiationThreadFooterProps> = ({
  request,
  isAgency,
  status,
  finalStatus,
  clientPriceStatus,
  currency,
  agencyCounterPrice,
  negotiationCounterExpanded,
  setNegotiationCounterExpanded,
  agencyCounterInput,
  setAgencyCounterInput,
  actionBusy = false,
  assignmentByClientOrgId,
  assignableMembers,
  onSaveClientAssignment,
  editingAssignmentThreadId,
  setEditingAssignmentThreadId,
  openOrgChatBusy,
  openOrgChatFromRequest,
  onAgencyConfirmAvailability,
  onAgencyAcceptClientPrice,
  onAgencyRejectClientPrice: _onAgencyRejectClientPrice,
  onAgencyCounterOffer,
  onAgencyProposeInitialFee,
  onRejectNegotiation,
  onClientAcceptCounter,
  onClientRejectCounter,
  onClientConfirmJob,
  showAgencyExtras = false,
  assignmentMode = 'manage',
  contextThreadLabel = uiCopy.optionNegotiationChat.negotiationContext,
  requireAgencyIdForOrgChat = true,
  suppressDuplicateMeta = false,
}) => {
  const busy = actionBusy;
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [actionsExpanded, setActionsExpanded] = useState(false);

  const signals = attentionSignalsFromOptionRequestLike({
    status: status ?? request.status,
    finalStatus: finalStatus ?? request.finalStatus ?? null,
    clientPriceStatus: clientPriceStatus ?? request.clientPriceStatus ?? null,
    modelApproval: request.modelApproval,
    modelAccountLinked: request.modelAccountLinked,
    agencyCounterPrice: agencyCounterPrice ?? null,
    proposedPrice: request.proposedPrice ?? null,
  });
  const priceLocked = priceCommerciallySettledForUi(signals);
  const isMobileNative = Platform.OS !== 'web';
  const agencyAwaitingClientOnCounter =
    isAgency &&
    !priceLocked &&
    agencyCounterPrice != null &&
    clientPriceStatus === 'pending' &&
    finalStatus !== 'job_confirmed' &&
    status !== 'rejected';

  const isTerminal = finalStatus === 'job_confirmed' || status === 'rejected';
  const availabilityNotYetConfirmed =
    finalStatus !== 'option_confirmed' && finalStatus !== 'job_confirmed';
  const modelLinked = request.modelAccountLinked === true;
  const modelPending = modelLinked && request.modelApproval === 'pending';

  const agencyHasActions = isAgency && !isTerminal;
  const showCollapsibleToggle = isMobileNative && agencyHasActions;

  const agencyActionsContent = (
    <>
      {/* ── Org chat row ── */}
      <View style={[
        { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginBottom: isMobileNative ? spacing.xs : spacing.sm },
        isMobileNative && { opacity: 0.8 },
      ]}>
        <View style={[styles.statusPill, { backgroundColor: '#e0e7ff' }, isMobileNative && styles.statusPillMobile]}>
          <Text style={[styles.statusPillLabel, { color: '#3730a3' }, isMobileNative && styles.statusPillLabelMobile]}>{contextThreadLabel}</Text>
        </View>
        <TouchableOpacity
          style={[
            isMobileNative ? styles.orgChatLink : styles.filterPill,
            openOrgChatBusy && { opacity: 0.6 },
          ]}
          disabled={
            openOrgChatBusy ||
            (requireAgencyIdForOrgChat && !request.agencyId) ||
            !request.clientOrganizationId
          }
          onPress={() => {
            void openOrgChatFromRequest();
          }}
        >
          <Text style={isMobileNative ? styles.orgChatLinkLabel : styles.filterPillLabel}>
            {openOrgChatBusy ? uiCopy.common.loading : uiCopy.b2bChat.openOrgChat}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Compact model-status hint (agency only) ── */}
      {isAgency && !isTerminal && modelPending && (
        <Text style={styles.compactHint}>
          {uiCopy.optionNegotiationChat.modelMustPreApproveBeforeAgencyActs}
        </Text>
      )}

      {/* ── Collapsible details toggle ── */}
      {isAgency && !isTerminal && (
        <TouchableOpacity
          style={{ marginBottom: spacing.xs }}
          onPress={() => setDetailsExpanded((prev) => !prev)}
        >
          <Text style={styles.toggleText}>
            {detailsExpanded
              ? uiCopy.optionNegotiationChat.hideDetails
              : uiCopy.optionNegotiationChat.showDetails}
          </Text>
        </TouchableOpacity>
      )}

      {/* ── Expandable detail banners ── */}
      {detailsExpanded && (
        <>
          {!suppressDuplicateMeta && showAgencyExtras && request.proposedPrice != null && (
            <Text style={{ ...typography.label, fontSize: 10, color: colors.accentBrown, marginBottom: spacing.xs }}>
              {uiCopy.optionNegotiationChat.proposedPriceLabel}:{' '}
              {currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'CHF' ? 'CHF ' : '€'}
              {request.proposedPrice}
            </Text>
          )}
          {!suppressDuplicateMeta && request.modelAccountLinked === false ? (
            <View style={styles.noModelBanner}>
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
                {uiCopy.dashboard.optionRequestFinalStatusNoModelAppHint}
              </Text>
            </View>
          ) : !suppressDuplicateMeta && showAgencyExtras ? (
            <View
              style={[
                styles.approvalBanner,
                request.modelApproval === 'approved' && styles.approvalBannerApproved,
                request.modelApproval === 'rejected' && styles.approvalBannerRejected,
                request.modelApproval === 'pending' && styles.approvalBannerPending,
              ]}
            >
              <Text
                style={[
                  styles.approvalBannerText,
                  request.modelApproval === 'approved' && styles.approvalBannerTextApproved,
                  request.modelApproval === 'rejected' && styles.approvalBannerTextRejected,
                  request.modelApproval === 'pending' && styles.approvalBannerTextPending,
                ]}
              >
                {request.modelApproval === 'approved'
                  ? uiCopy.dashboard.optionRequestModelApprovalApproved
                  : request.modelApproval === 'rejected'
                    ? uiCopy.dashboard.optionRequestModelApprovalRejected
                    : uiCopy.dashboard.optionRequestModelApprovalPending}
              </Text>
            </View>
          ) : null}
          {!suppressDuplicateMeta && finalStatus ? (
            <View
              style={[
                styles.finalBanner,
                finalStatus === 'job_confirmed'
                  ? { backgroundColor: 'rgba(0,120,0,0.15)' }
                  : finalStatus === 'option_confirmed'
                    ? { backgroundColor: 'rgba(0,80,200,0.12)' }
                    : { backgroundColor: 'rgba(120,120,0,0.12)' },
              ]}
            >
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary, flexShrink: 1 }}>
                {request.requestType === 'casting' ? uiCopy.dashboard.threadContextCasting : uiCopy.dashboard.threadContextOption} -{' '}
                {finalStatus === 'job_confirmed'
                  ? uiCopy.dashboard.optionRequestStatusJobConfirmed
                  : finalStatus === 'option_confirmed'
                    ? uiCopy.dashboard.optionRequestStatusConfirmed
                    : uiCopy.dashboard.optionRequestStatusPending}
              </Text>
            </View>
          ) : null}
        </>
      )}

      {/* ── Axis 2: Confirm availability ── */}
      {isAgency && !isTerminal && availabilityNotYetConfirmed && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
          <TouchableOpacity
            style={[styles.filterPill, { backgroundColor: colors.buttonOptionGreen }, busy && { opacity: 0.5 }]}
            disabled={busy}
            onPress={() => { void onAgencyConfirmAvailability(); }}
          >
            <Text style={[styles.filterPillLabel, { color: '#fff' }]}>{uiCopy.optionNegotiationChat.confirmOption}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterPill, { borderWidth: 1, borderColor: colors.buttonSkipRed }]}
            onPress={onRejectNegotiation}
          >
            <Text style={[styles.filterPillLabel, { color: colors.buttonSkipRed }]}>{uiCopy.optionNegotiationChat.rejectOption}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Agency waiting for client on counter ── */}
      {isAgency && agencyAwaitingClientOnCounter && (
        <>
          <Text style={styles.compactHint}>
            {uiCopy.optionNegotiationChat.agencyCounterAwaitingClientResponse}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
            <TouchableOpacity
              style={[styles.filterPill, { borderWidth: 1, borderColor: colors.buttonSkipRed }, busy && { opacity: 0.5 }]}
              disabled={busy}
              onPress={onRejectNegotiation}
            >
              <Text style={[styles.filterPillLabel, { color: colors.buttonSkipRed }]}>
                {uiCopy.optionNegotiationChat.rejectOption}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ── Axis 1: Price actions (Accept + inline counter) ── */}
      {isAgency &&
        !priceLocked &&
        !agencyAwaitingClientOnCounter &&
        !isTerminal && (
        <>
          {request.proposedPrice != null &&
          clientPriceStatus === 'pending' &&
          agencyCounterPrice == null ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
              <TouchableOpacity
                style={[styles.filterPill, { backgroundColor: colors.accentBrown }, busy && { opacity: 0.5 }]}
                disabled={busy}
                onPress={() => { void onAgencyAcceptClientPrice(); }}
              >
                <Text style={[styles.filterPillLabel, { color: '#fff' }]}>{uiCopy.optionNegotiationChat.acceptProposedFee}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      )}

      {/* ── Counter-offer input (pending proposed — always visible when price is pending) ── */}
      {isAgency &&
        !priceLocked &&
        clientPriceStatus === 'pending' &&
        request.proposedPrice != null &&
        agencyCounterPrice == null &&
        !isTerminal && (
          <View style={styles.counterBox}>
            <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary, marginBottom: spacing.xs }}>
              {uiCopy.optionNegotiationChat.counterOfferPendingHint}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <TextInput
                value={agencyCounterInput}
                onChangeText={setAgencyCounterInput}
                placeholder={uiCopy.optionNegotiationChat.counterPlaceholder}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[styles.chatInput, { flex: 1, minWidth: 120 }]}
              />
              <TouchableOpacity
                style={[styles.filterPill, { paddingHorizontal: spacing.sm, backgroundColor: colors.textPrimary }, busy && { opacity: 0.5 }]}
                disabled={busy}
                onPress={() => {
                  const num = parseFloat(agencyCounterInput.trim());
                  if (isNaN(num)) return;
                  void onAgencyCounterOffer(num);
                }}
              >
                <Text style={[styles.filterPillLabel, { color: '#fff' }]}>{uiCopy.optionNegotiationChat.sendCounter}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.filterPill}
                onPress={() => {
                  setAgencyCounterInput('');
                  setNegotiationCounterExpanded(false);
                }}
              >
                <Text style={styles.filterPillLabel}>{uiCopy.common.cancel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

      {/* ── Counter-offer input (after client decline) ── */}
      {isAgency &&
        negotiationCounterExpanded &&
        !priceLocked &&
        clientPriceStatus === 'rejected' &&
        !isTerminal && (
          <View style={styles.counterBox}>
            <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary, marginBottom: spacing.xs }}>
              {uiCopy.optionNegotiationChat.agencyNegotiationAfterClientDecline}
            </Text>
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: spacing.xs }}>
              {uiCopy.optionNegotiationChat.clientPriceDeclinedCounterHint}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <TextInput
                value={agencyCounterInput}
                onChangeText={setAgencyCounterInput}
                placeholder={uiCopy.optionNegotiationChat.counterPlaceholder}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[styles.chatInput, { flex: 1, minWidth: 120 }]}
              />
              <TouchableOpacity
                style={[styles.filterPill, { paddingHorizontal: spacing.sm, backgroundColor: colors.textPrimary }, busy && { opacity: 0.5 }]}
                disabled={busy}
                onPress={() => {
                  const num = parseFloat(agencyCounterInput.trim());
                  if (isNaN(num)) return;
                  void onAgencyCounterOffer(num);
                }}
              >
                <Text style={[styles.filterPillLabel, { color: '#fff' }]}>{uiCopy.optionNegotiationChat.sendCounter}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

      {/* ── Propose initial fee (no price yet) ── */}
      {isAgency &&
        negotiationCounterExpanded &&
        !priceLocked &&
        clientPriceStatus === 'pending' &&
        !isTerminal &&
        request.proposedPrice == null && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' }}>
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary }}>{uiCopy.optionNegotiationChat.proposeFeeHint}</Text>
            <TextInput
              value={agencyCounterInput}
              onChangeText={setAgencyCounterInput}
              placeholder={uiCopy.optionNegotiationChat.counterPlaceholder}
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
              style={[styles.chatInput, { width: 100 }]}
            />
            <TouchableOpacity
              style={[styles.filterPill, { paddingHorizontal: spacing.sm }, busy && { opacity: 0.5 }]}
              disabled={busy}
              onPress={() => {
                const num = parseFloat(agencyCounterInput.trim());
                if (isNaN(num)) return;
                void onAgencyProposeInitialFee(num);
              }}
            >
              <Text style={styles.filterPillLabel}>{uiCopy.optionNegotiationChat.sendOffer}</Text>
            </TouchableOpacity>
          </View>
        )}
    </>
  );

  return (
    <>
      {/* ── Assignment (readonly or manage) ── */}
      {assignmentMode === 'readonly' && request.clientOrganizationId && assignmentByClientOrgId[request.clientOrganizationId] ? (
        <Text style={[styles.metaText, { marginBottom: spacing.xs }]}>
          {uiCopy.optionNegotiationChat.clientAssignmentLabel}: {assignmentByClientOrgId[request.clientOrganizationId].label}
          {assignmentByClientOrgId[request.clientOrganizationId].assignedMemberName
            ? ` · ${assignmentByClientOrgId[request.clientOrganizationId].assignedMemberName}`
            : ''}
        </Text>
      ) : null}
      {assignmentMode === 'manage' && request.clientOrganizationId && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: isMobileNative ? spacing.xs : spacing.sm }}>
          {assignmentByClientOrgId[request.clientOrganizationId] ? (
            <Text style={styles.metaText}>
              {uiCopy.optionNegotiationChat.clientFlagLabel}: {assignmentByClientOrgId[request.clientOrganizationId].label}
              {assignmentByClientOrgId[request.clientOrganizationId].assignedMemberName
                ? ` · ${assignmentByClientOrgId[request.clientOrganizationId].assignedMemberName}`
                : ''}
            </Text>
          ) : (
            <Text style={styles.metaText}>{uiCopy.optionNegotiationChat.clientFlagLabel}: {uiCopy.optionNegotiationChat.clientFlagNone}</Text>
          )}
          {isAgency && onSaveClientAssignment && (
            <TouchableOpacity
              style={styles.filterPill}
              onPress={() =>
                setEditingAssignmentThreadId((prev) => (prev === request.threadId ? null : request.threadId))
              }
            >
              <Text style={styles.filterPillLabel}>{uiCopy.optionNegotiationChat.editLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {assignmentMode === 'manage' && isAgency && onSaveClientAssignment && request.clientOrganizationId && editingAssignmentThreadId === request.threadId && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
          {(['gray', 'blue', 'green', 'amber', 'purple', 'red'] as AssignmentFlagColor[]).map((color) => (
            <TouchableOpacity
              key={color}
              style={styles.filterPill}
              onPress={() => {
                void onSaveClientAssignment(request.clientOrganizationId!, {
                  label: color.toUpperCase(),
                  color,
                  assignedMemberUserId:
                    assignmentByClientOrgId[request.clientOrganizationId!]?.assignedMemberUserId ?? null,
                });
                setEditingAssignmentThreadId(null);
              }}
            >
              <Text style={styles.filterPillLabel}>{color}</Text>
            </TouchableOpacity>
          ))}
          {assignableMembers.slice(0, 6).map((member) => (
            <TouchableOpacity
              key={member.userId}
              style={styles.filterPill}
              onPress={() => {
                const current = assignmentByClientOrgId[request.clientOrganizationId!];
                void onSaveClientAssignment!(request.clientOrganizationId!, {
                  label: current?.label ?? 'BLUE',
                  color: current?.color ?? 'blue',
                  assignedMemberUserId: member.userId,
                });
                setEditingAssignmentThreadId(null);
              }}
            >
              <Text style={styles.filterPillLabel}>{member.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Mobile agency: collapsible actions toggle ── */}
      {showCollapsibleToggle && (
        <TouchableOpacity
          style={styles.actionsToggle}
          onPress={() => setActionsExpanded((prev) => !prev)}
          activeOpacity={0.6}
        >
          <View style={styles.actionsToggleInner}>
            <Text style={styles.actionsToggleArrow}>
              {actionsExpanded ? '▾' : '▸'}
            </Text>
            <Text style={styles.actionsToggleLabel}>
              {actionsExpanded ? 'Hide actions' : 'Actions'}
            </Text>
          </View>
          {!actionsExpanded && !isTerminal && (
            <View style={styles.actionsToggleBadge}>
              <View style={styles.actionsToggleDot} />
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* ── Agency actions (collapsible on mobile, always visible on desktop/web) ── */}
      {isAgency && (!showCollapsibleToggle || actionsExpanded) && agencyActionsContent}

      {/* ── Non-agency content (org chat row for client) ── */}
      {!isAgency && (
        <View style={[
          { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginBottom: isMobileNative ? spacing.xs : spacing.sm },
          isMobileNative && { opacity: 0.8 },
        ]}>
          <View style={[styles.statusPill, { backgroundColor: '#e0e7ff' }, isMobileNative && styles.statusPillMobile]}>
            <Text style={[styles.statusPillLabel, { color: '#3730a3' }, isMobileNative && styles.statusPillLabelMobile]}>{contextThreadLabel}</Text>
          </View>
          <TouchableOpacity
            style={[
              isMobileNative ? styles.orgChatLink : styles.filterPill,
              openOrgChatBusy && { opacity: 0.6 },
            ]}
            disabled={
              openOrgChatBusy ||
              (requireAgencyIdForOrgChat && !request.agencyId) ||
              !request.clientOrganizationId
            }
            onPress={() => {
              void openOrgChatFromRequest();
            }}
          >
            <Text style={isMobileNative ? styles.orgChatLinkLabel : styles.filterPillLabel}>
              {openOrgChatBusy ? uiCopy.common.loading : uiCopy.b2bChat.openOrgChat}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Client: accept agency counter (price only) ── */}
      {!isAgency &&
        !priceLocked &&
        agencyCounterPrice != null &&
        clientPriceStatus === 'pending' &&
        !isTerminal && (
        <View style={{ marginBottom: spacing.sm, gap: spacing.xs }}>
          <TouchableOpacity
            style={[styles.filterPill, { backgroundColor: colors.buttonOptionGreen }]}
            onPress={() => { void onClientAcceptCounter(); }}
          >
            <Text style={[styles.filterPillLabel, { color: '#fff' }]}>
              {uiCopy.optionNegotiationChat.acceptAgencyProposal} ({currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'CHF' ? 'CHF ' : '€'}
              {agencyCounterPrice})
            </Text>
          </TouchableOpacity>
          {onClientRejectCounter ? (
            <TouchableOpacity
              style={[styles.filterPill, { borderWidth: 1, borderColor: colors.buttonSkipRed }]}
              onPress={() => { void onClientRejectCounter(); }}
            >
              <Text style={[styles.filterPillLabel, { color: colors.buttonSkipRed }]}>
                {uiCopy.optionNegotiationChat.rejectCounterOffer}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* ── Client: confirm job (requires BOTH axes settled) ── */}
      {!isAgency &&
        clientMayConfirmJobFromSignals(signals) &&
        request?.requestType === 'option' &&
        status !== 'rejected' && (
        <TouchableOpacity
          style={[styles.filterPill, { marginBottom: spacing.sm, backgroundColor: colors.accentBrown }]}
          onPress={() => { void onClientConfirmJob(); }}
        >
          <Text style={[styles.filterPillLabel, { color: '#fff' }]}>{uiCopy.optionNegotiationChat.confirmJob}</Text>
        </TouchableOpacity>
      )}

      {/* ── Terminal state hint ── */}
      {isTerminal && (
        <Text style={styles.compactHint}>
          {finalStatus === 'job_confirmed'
            ? uiCopy.optionNegotiationChat.negotiationFeeClosedJobConfirmed
            : uiCopy.optionNegotiationChat.negotiationFeeClosedRejected}
        </Text>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  metaText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  filterPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filterPillLabel: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusPillMobile: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusPillLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  statusPillLabelMobile: {
    fontSize: 10,
  },
  orgChatLink: {
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  orgChatLinkLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
    fontWeight: '500',
  },
  chatInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  noModelBanner: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: 'rgba(100,100,100,0.12)',
    borderRadius: 8,
  },
  finalBanner: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: 8,
  },
  counterBox: {
    marginBottom: spacing.sm,
    padding: spacing.sm,
    backgroundColor: 'rgba(180,100,0,0.08)',
    borderRadius: 8,
  },
  approvalBanner: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  approvalBannerApproved: { borderColor: colors.buttonOptionGreen, backgroundColor: 'rgba(76,175,80,0.08)' },
  approvalBannerRejected: { borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.08)' },
  approvalBannerPending: { borderColor: '#B8860B', backgroundColor: 'rgba(184,134,11,0.08)' },
  approvalBannerText: { ...typography.label, fontSize: 11, color: colors.textSecondary },
  approvalBannerTextApproved: { color: colors.buttonOptionGreen },
  approvalBannerTextRejected: { color: '#e74c3c' },
  approvalBannerTextPending: { color: '#B8860B' },
  compactHint: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  toggleText: {
    fontSize: 11,
    color: colors.accentBrown,
    textDecorationLine: 'underline',
    fontWeight: '500',
  },
  actionsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    backgroundColor: 'rgba(139,90,43,0.08)',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(139,90,43,0.2)',
  },
  actionsToggleInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionsToggleArrow: {
    fontSize: 16,
    color: colors.accentBrown,
    fontWeight: '700',
  },
  actionsToggleLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accentBrown,
    letterSpacing: 0.2,
  },
  actionsToggleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionsToggleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accentBrown,
  },
});

/** Plan name: structured negotiation footer + inline counter — alias of NegotiationThreadFooter. */
export const NegotiationActionBar = NegotiationThreadFooter;

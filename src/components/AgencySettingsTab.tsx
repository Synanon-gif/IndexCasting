import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { AGENCY_SEGMENT_TYPES } from '../constants/agencyTypes';
import type { Agency } from '../services/agenciesSupabase';
import { updateAgencySettings } from '../services/agencySettingsSupabase';
import { showAppAlert } from '../utils/crossPlatformAlert';
import { ScreenScrollView } from './ScreenScrollView';
import { AgencyStorageWidget } from './AgencyStorageWidget';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  exportUserData,
  downloadUserDataExport,
  userFacingExportErrorMessage,
} from '../services/gdprComplianceSupabase';
import { withdrawConsent } from '../services/consentSupabase';
import {
  downloadCalendarIcsFile,
  rotateCalendarFeedToken,
  revokeCalendarFeedToken,
  calendarFeedSubscribeUrl,
  calendarFeedWebcalUrl,
} from '../services/calendarFeedSupabase';

type Props = {
  agency: Agency | null;
  organizationId: string | null;
  onSaved: () => void;
  /** `embedded`: inner content only — parent supplies `ScreenScrollView` (e.g. owner settings + metrics + delete). */
  variant?: 'scroll' | 'embedded';
};

export const AgencySettingsTab: React.FC<Props> = ({
  agency,
  organizationId,
  onSaved,
  variant = 'scroll',
}) => {
  const { refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [segments, setSegments] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [withdrawingConsent, setWithdrawingConsent] = useState(false);
  const [calendarIcsBusy, setCalendarIcsBusy] = useState(false);
  const [calendarFeedBusy, setCalendarFeedBusy] = useState(false);
  const [calendarRevokeBusy, setCalendarRevokeBusy] = useState(false);

  const runWithdrawConsent = async () => {
    setWithdrawingConsent(true);
    try {
      const m = await withdrawConsent('marketing', 'user_requested');
      const a = await withdrawConsent('analytics', 'user_requested');
      if (!m.ok || !a.ok) {
        showAppAlert(uiCopy.common.error, uiCopy.privacyData.couldNotWithdrawConsent);
        return;
      }
      void refreshProfile();
      showAppAlert(
        uiCopy.privacyData.consentWithdrawnTitle,
        uiCopy.privacyData.consentWithdrawnBody,
      );
    } catch (e) {
      console.error('AgencySettingsTab onWithdrawConsent error:', e);
      showAppAlert(uiCopy.common.error, uiCopy.privacyData.couldNotWithdrawConsent);
    } finally {
      setWithdrawingConsent(false);
    }
  };

  const onWithdrawConsent = () => {
    const pd = uiCopy.privacyData;
    if (Platform.OS === 'web') {
      const confirmed = (window as Window & typeof globalThis).confirm?.(pd.withdrawConfirmWeb);
      if (!confirmed) return;
      void runWithdrawConsent();
      return;
    }
    Alert.alert(pd.withdrawOptionalConsent, pd.withdrawConfirmWeb, [
      { text: uiCopy.common.cancel, style: 'cancel' },
      { text: uiCopy.common.confirm, onPress: () => void runWithdrawConsent() },
    ]);
  };

  const onExportData = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setExportingData(true);
    try {
      if (Platform.OS === 'web') {
        const dl = await downloadUserDataExport(user.id);
        if (dl.ok) {
          showAppAlert(
            uiCopy.privacyData.downloadStartedTitle,
            uiCopy.privacyData.downloadStartedBody,
          );
        } else {
          showAppAlert(uiCopy.common.error, userFacingExportErrorMessage(dl.reason));
        }
      } else {
        const result = await exportUserData(user.id);
        if (result.ok) {
          showAppAlert(uiCopy.privacyData.exportNativeTitle, uiCopy.privacyData.exportNativeBody);
        } else {
          showAppAlert(uiCopy.common.error, userFacingExportErrorMessage(result.reason));
        }
      }
    } catch (e) {
      console.error('AgencySettingsTab onExportData error:', e);
      showAppAlert(uiCopy.common.error, uiCopy.privacyData.couldNotExport);
    } finally {
      setExportingData(false);
    }
  };

  const onDownloadCalendarIcs = async () => {
    if (Platform.OS !== 'web') {
      showAppAlert(
        uiCopy.privacyData.calendarIcsWebOnlyTitle,
        uiCopy.privacyData.calendarIcsWebOnlyBody,
      );
      return;
    }
    setCalendarIcsBusy(true);
    try {
      const r = await downloadCalendarIcsFile();
      if (!r.ok) {
        showAppAlert(uiCopy.common.error, uiCopy.privacyData.calendarDownloadFailed);
      } else {
        showAppAlert(
          uiCopy.privacyData.calendarDownloadStartedTitle,
          uiCopy.privacyData.calendarDownloadStartedBody,
        );
      }
    } finally {
      setCalendarIcsBusy(false);
    }
  };

  const onCreateCalendarFeed = async () => {
    setCalendarFeedBusy(true);
    try {
      const r = await rotateCalendarFeedToken();
      if (!r.ok) {
        showAppAlert(uiCopy.common.error, uiCopy.privacyData.calendarFeedRotateFailed);
        return;
      }
      const httpsUrl = calendarFeedSubscribeUrl(r.token);
      const webcalUrl = calendarFeedWebcalUrl(r.token);
      const body = `${uiCopy.privacyData.calendarFeedCreatedBody}\n\nHTTPS:\n${httpsUrl}\n\nwebcal:\n${webcalUrl}`;
      if (
        Platform.OS === 'web' &&
        typeof navigator !== 'undefined' &&
        navigator.clipboard?.writeText
      ) {
        try {
          await navigator.clipboard.writeText(httpsUrl);
        } catch {
          /* non-fatal */
        }
      }
      Alert.alert(uiCopy.privacyData.calendarFeedCreatedTitle, body);
    } finally {
      setCalendarFeedBusy(false);
    }
  };

  const onRevokeCalendarFeed = () => {
    Alert.alert(uiCopy.common.confirm, uiCopy.privacyData.calendarRevokeFeedConfirm, [
      { text: uiCopy.common.cancel, style: 'cancel' },
      {
        text: uiCopy.privacyData.calendarRevokeFeed,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setCalendarRevokeBusy(true);
            try {
              const ok = await revokeCalendarFeedToken();
              showAppAlert(
                ok ? uiCopy.common.success : uiCopy.common.error,
                ok
                  ? uiCopy.privacyData.calendarRevokeDone
                  : uiCopy.privacyData.calendarRevokeFailed,
              );
            } finally {
              setCalendarRevokeBusy(false);
            }
          })();
        },
      },
    ]);
  };

  useEffect(() => {
    if (!agency) return;
    setName(agency.name ?? '');
    setDescription(agency.description ?? '');
    setEmail(agency.email ?? '');
    setPhone(agency.phone ?? '');
    setWebsite(agency.website ?? '');
    setStreet(agency.street ?? '');
    setCity(agency.city ?? '');
    setCountry(agency.country ?? '');
    setSegments(new Set((agency.agency_types ?? []).filter(Boolean)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency?.id]);

  const toggleSegment = (s: string) => {
    setSegments((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const onSave = async () => {
    if (!agency?.id) return;
    setSaving(true);
    try {
      const r = await updateAgencySettings({
        agencyId: agency.id,
        organizationId,
        payload: {
          name: name.trim() || agency.name,
          description: description.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          website: website.trim() || null,
          street: street.trim() || null,
          city: city.trim() || null,
          country: country.trim() || null,
          agency_types: [...segments],
        },
      });
      if (!r.ok) {
        showAppAlert(uiCopy.common.error, r.message);
        return;
      }
      showAppAlert(uiCopy.common.success, uiCopy.agencySettings.saveSuccess);
      onSaved();
    } catch (e) {
      console.error('AgencySettingsTab onSave error:', e);
      showAppAlert(
        uiCopy.common.error,
        uiCopy.agencySettings.saveError ?? 'Could not save settings.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!agency) {
    const loading = <Text style={styles.meta}>{uiCopy.common.loading}</Text>;
    if (variant === 'embedded') return loading;
    return <ScreenScrollView>{loading}</ScreenScrollView>;
  }

  const body = (
    <>
      <Text style={styles.heading}>{uiCopy.agencySettings.screenTitle}</Text>
      <Text style={styles.meta}>{uiCopy.agencySettings.intro}</Text>

      <Text style={styles.section}>{uiCopy.agencySettings.sectionGeneral}</Text>
      <Text style={styles.label}>{uiCopy.agencySettings.fieldName}</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Name"
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
      />
      <Text style={styles.label}>{uiCopy.agencySettings.fieldDescription}</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Short description"
        placeholderTextColor={colors.textSecondary}
        style={[styles.input, styles.multiline]}
        multiline
      />

      <Text style={styles.section}>{uiCopy.agencySettings.sectionContact}</Text>
      <Text style={styles.label}>{uiCopy.agencySettings.fieldEmail}</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="contact@agency.com"
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Text style={styles.label}>{uiCopy.agencySettings.fieldPhone}</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="+1 …"
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
        keyboardType="phone-pad"
      />
      <Text style={styles.label}>{uiCopy.agencySettings.fieldWebsite}</Text>
      <TextInput
        value={website}
        onChangeText={setWebsite}
        placeholder="https://"
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
        autoCapitalize="none"
      />

      <Text style={styles.section}>{uiCopy.agencySettings.sectionAddress}</Text>
      <Text style={styles.label}>{uiCopy.agencySettings.fieldStreet}</Text>
      <TextInput
        value={street}
        onChangeText={setStreet}
        placeholder="Street"
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
      />
      <Text style={styles.label}>{uiCopy.agencySettings.fieldCity}</Text>
      <TextInput
        value={city}
        onChangeText={setCity}
        placeholder="City"
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
      />
      <Text style={styles.label}>{uiCopy.agencySettings.fieldCountry}</Text>
      <TextInput
        value={country}
        onChangeText={setCountry}
        placeholder="Country"
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
      />

      <Text style={styles.section}>{uiCopy.agencySettings.sectionSegments}</Text>
      <Text style={styles.hint}>{uiCopy.agencySettings.segmentsHint}</Text>
      <View style={styles.segmentRow}>
        {AGENCY_SEGMENT_TYPES.map((seg) => (
          <TouchableOpacity
            key={seg}
            style={[styles.segmentChip, segments.has(seg) && styles.segmentChipOn]}
            onPress={() => toggleSegment(seg)}
          >
            <Text style={[styles.segmentLabel, segments.has(seg) && styles.segmentLabelOn]}>
              {seg}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Storage Usage ─────────────────────────────────────── */}
      <View style={styles.storageDivider} />
      <AgencyStorageWidget />

      <TouchableOpacity
        style={[styles.saveBtn, saving && { opacity: 0.6 }]}
        disabled={saving}
        onPress={() => void onSave()}
      >
        <Text style={styles.saveLabel}>
          {saving ? uiCopy.common.saving : uiCopy.agencySettings.save}
        </Text>
      </TouchableOpacity>

      {/* ── GDPR / Privacy ──────────────────────────────────────── */}
      <View style={styles.gdprDivider} />
      <Text style={styles.section}>{uiCopy.privacyData.sectionTitle}</Text>
      <Text style={styles.hint}>{uiCopy.privacyData.art20Body}</Text>
      <TouchableOpacity
        style={[styles.gdprBtn, exportingData && { opacity: 0.6 }]}
        disabled={exportingData}
        onPress={() => void onExportData()}
      >
        <Text style={styles.gdprBtnLabel}>
          {exportingData ? uiCopy.privacyData.preparingExport : uiCopy.privacyData.downloadMyData}
        </Text>
      </TouchableOpacity>

      <Text style={styles.hint}>{uiCopy.privacyData.calendarSectionTitle}</Text>
      <Text style={styles.hint}>{uiCopy.privacyData.calendarSectionBody}</Text>
      <TouchableOpacity
        style={[styles.gdprBtn, calendarIcsBusy && { opacity: 0.6 }]}
        disabled={calendarIcsBusy}
        onPress={() => void onDownloadCalendarIcs()}
      >
        <Text style={styles.gdprBtnLabel}>
          {calendarIcsBusy ? uiCopy.common.loading : uiCopy.privacyData.downloadCalendarIcs}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.gdprBtn, calendarFeedBusy && { opacity: 0.6 }]}
        disabled={calendarFeedBusy}
        onPress={() => void onCreateCalendarFeed()}
      >
        <Text style={styles.gdprBtnLabel}>
          {calendarFeedBusy ? uiCopy.common.loading : uiCopy.privacyData.rotateCalendarFeed}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.gdprBtn,
          calendarRevokeBusy && { opacity: 0.6 },
          { borderColor: colors.error },
        ]}
        disabled={calendarRevokeBusy}
        onPress={() => onRevokeCalendarFeed()}
      >
        <Text style={[styles.gdprBtnLabel, { color: colors.error }]}>
          {calendarRevokeBusy ? uiCopy.common.loading : uiCopy.privacyData.calendarRevokeFeed}
        </Text>
      </TouchableOpacity>

      <Text style={styles.hint}>{uiCopy.privacyData.art7Body}</Text>
      <TouchableOpacity
        style={[styles.gdprBtn, withdrawingConsent && { opacity: 0.6 }]}
        disabled={withdrawingConsent}
        onPress={() => onWithdrawConsent()}
      >
        <Text style={styles.gdprBtnLabel}>
          {withdrawingConsent
            ? uiCopy.privacyData.withdrawingConsent
            : uiCopy.privacyData.withdrawOptionalConsent}
        </Text>
      </TouchableOpacity>
    </>
  );

  if (variant === 'embedded') return body;
  return <ScreenScrollView>{body}</ScreenScrollView>;
};

const styles = StyleSheet.create({
  heading: { ...typography.heading, marginBottom: spacing.sm, color: colors.textPrimary },
  meta: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  section: {
    ...typography.label,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    color: colors.textPrimary,
  },
  hint: { ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm },
  label: { ...typography.label, fontSize: 11, color: colors.textSecondary, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  segmentChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  segmentChipOn: { borderColor: colors.accentGreen, backgroundColor: colors.surface },
  segmentLabel: { ...typography.body, fontSize: 13, color: colors.textSecondary },
  segmentLabelOn: { color: colors.accentGreen, fontWeight: '600' },
  storageDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  saveBtn: {
    backgroundColor: colors.buttonOptionGreen,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  saveLabel: { ...typography.label, color: '#fff' },
  gdprDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  gdprBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  gdprBtnLabel: { ...typography.label, color: colors.textSecondary },
});

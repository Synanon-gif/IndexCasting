import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { AGENCY_SEGMENT_TYPES } from '../constants/agencyTypes';
import type { Agency } from '../services/agenciesSupabase';
import { updateAgencySettings } from '../services/agencySettingsSupabase';
import { showAppAlert } from '../utils/crossPlatformAlert';
import { ScreenScrollView } from './ScreenScrollView';
import { AgencyStorageWidget } from './AgencyStorageWidget';
import { supabase } from '../../lib/supabase';
import { exportUserData, downloadUserDataExport } from '../services/gdprComplianceSupabase';

type Props = {
  agency: Agency | null;
  organizationId: string | null;
  onSaved: () => void;
};

export const AgencySettingsTab: React.FC<Props> = ({ agency, organizationId, onSaved }) => {
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

  const onExportData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setExportingData(true);
    try {
      if (Platform.OS === 'web') {
        await downloadUserDataExport(user.id);
        showAppAlert('Download started', 'Your data export has been downloaded as a JSON file.');
      } else {
        const result = await exportUserData(user.id);
        if (result.ok) {
          showAppAlert('Data Export', 'Your personal data export was prepared. Please use the web version of IndexCasting to download your data as a file.');
        } else {
          showAppAlert(uiCopy.common.error, 'Could not export your data. Please try again later.');
        }
      }
    } catch (e) {
      console.error('AgencySettingsTab onExportData error:', e);
      showAppAlert(uiCopy.common.error, 'Could not export your data. Please try again later.');
    } finally {
      setExportingData(false);
    }
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
      showAppAlert(uiCopy.common.error, uiCopy.agencySettings.saveError ?? 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (!agency) {
    return (
      <ScreenScrollView>
        <Text style={styles.meta}>{uiCopy.common.loading}</Text>
      </ScreenScrollView>
    );
  }

  return (
    <ScreenScrollView>
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
            <Text style={[styles.segmentLabel, segments.has(seg) && styles.segmentLabelOn]}>{seg}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Storage Usage ─────────────────────────────────────── */}
      <View style={styles.storageDivider} />
      <AgencyStorageWidget />

      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={() => void onSave()}>
        <Text style={styles.saveLabel}>{saving ? uiCopy.common.saving : uiCopy.agencySettings.save}</Text>
      </TouchableOpacity>

      {/* ── GDPR / Privacy ──────────────────────────────────────── */}
      <View style={styles.gdprDivider} />
      <Text style={styles.section}>Privacy & Your Data (GDPR)</Text>
      <Text style={styles.hint}>
        Under GDPR Art. 20 you have the right to receive a copy of your personal data.
      </Text>
      <TouchableOpacity
        style={[styles.gdprBtn, exportingData && { opacity: 0.6 }]}
        disabled={exportingData}
        onPress={() => void onExportData()}
      >
        <Text style={styles.gdprBtnLabel}>{exportingData ? 'Preparing export…' : 'Download my data'}</Text>
      </TouchableOpacity>
    </ScreenScrollView>
  );
};

const styles = StyleSheet.create({
  heading: { ...typography.heading, marginBottom: spacing.sm, color: colors.textPrimary },
  meta: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  section: { ...typography.label, marginTop: spacing.md, marginBottom: spacing.xs, color: colors.textPrimary },
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

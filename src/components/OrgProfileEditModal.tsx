/**
 * OrgProfileEditModal — Phase 2C.1
 *
 * Owner-only modal sheet for editing organization profile text/contact fields.
 * Shared between AgencyOrgProfileScreen and ClientOrgProfileScreen.
 *
 * Non-owners never receive this component (the parent conditionally renders
 * it only when isOwner === true). Backend `op_owner_update` RLS enforces
 * write access independently of frontend role checks.
 */

import React, { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { upsertOrganizationProfile } from '../services/organizationProfilesSupabase';
import {
  validateOrgProfileEditFields,
  type OrgProfileEditValues,
} from '../utils/orgProfileEditValidation';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface OrgProfileEditModalProps {
  visible: boolean;
  onClose: () => void;
  organizationId: string;
  initialValues: OrgProfileEditValues;
  onSaved: (updated: OrgProfileEditValues) => void;
}

// ─── Field config ─────────────────────────────────────────────────────────────

type FieldKey = keyof OrgProfileEditValues;

const FIELDS: Array<{
  key: FieldKey;
  label: string;
  placeholder: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'url';
  autoCapitalize?: 'none' | 'sentences' | 'words';
}> = [
  {
    key: 'description',
    label: 'Description',
    placeholder: 'A short description of your organization…',
    multiline: true,
    autoCapitalize: 'sentences',
  },
  {
    key: 'address_line_1',
    label: 'Address',
    placeholder: 'Street and number',
    autoCapitalize: 'words',
  },
  {
    key: 'city',
    label: 'City',
    placeholder: 'City',
    autoCapitalize: 'words',
  },
  {
    key: 'postal_code',
    label: 'Postal code',
    placeholder: 'Postal code',
    autoCapitalize: 'none',
  },
  {
    key: 'country',
    label: 'Country',
    placeholder: 'Country',
    autoCapitalize: 'words',
  },
  {
    key: 'website_url',
    label: 'Website',
    placeholder: 'https://example.com',
    keyboardType: 'url',
    autoCapitalize: 'none',
  },
  {
    key: 'contact_email',
    label: 'Contact email',
    placeholder: 'contact@example.com',
    keyboardType: 'email-address',
    autoCapitalize: 'none',
  },
  {
    key: 'contact_phone',
    label: 'Phone',
    placeholder: '+49 123 456789',
    keyboardType: 'phone-pad',
    autoCapitalize: 'none',
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function OrgProfileEditModal({
  visible,
  onClose,
  organizationId,
  initialValues,
  onSaved,
}: OrgProfileEditModalProps) {
  const [form, setForm] = useState<OrgProfileEditValues>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleChange = useCallback((key: FieldKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value === '' ? null : value }));
    // Clear the per-field error as the user types
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    const errors = validateOrgProfileEditFields(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    setSaveError(null);

    const ok = await upsertOrganizationProfile(organizationId, {
      description: form.description,
      address_line_1: form.address_line_1,
      city: form.city,
      postal_code: form.postal_code,
      country: form.country,
      website_url: form.website_url,
      contact_email: form.contact_email,
      contact_phone: form.contact_phone,
    });

    setSaving(false);

    if (ok) {
      onSaved(form);
    } else {
      setSaveError('Could not save changes. Please try again.');
    }
  }, [form, organizationId, onSaved]);

  const handleCancel = useCallback(() => {
    // Reset local state so next open starts fresh from initialValues
    setForm(initialValues);
    setFieldErrors({});
    setSaveError(null);
    onClose();
  }, [initialValues, onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <SafeAreaView style={styles.safeArea}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleCancel}
            disabled={saving}
            hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={[styles.headerAction, saving && styles.headerActionDisabled]}>
              Cancel
            </Text>
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Edit Profile</Text>

          <TouchableOpacity
            onPress={() => void handleSave()}
            disabled={saving}
            hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Save"
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Text style={[styles.headerAction, styles.headerActionSave]}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Error banner ── */}
        {saveError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{saveError}</Text>
          </View>
        ) : null}

        {/* ── Form ── */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {FIELDS.map((field) => (
            <View key={field.key} style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <TextInput
                style={[
                  styles.fieldInput,
                  field.multiline && styles.fieldInputMultiline,
                  fieldErrors[field.key] ? styles.fieldInputError : null,
                ]}
                value={form[field.key] ?? ''}
                onChangeText={(v) => handleChange(field.key, v)}
                placeholder={field.placeholder}
                placeholderTextColor={colors.textSecondary}
                multiline={field.multiline}
                numberOfLines={field.multiline ? 4 : 1}
                keyboardType={field.keyboardType ?? 'default'}
                autoCapitalize={field.autoCapitalize ?? 'sentences'}
                autoCorrect={!field.autoCapitalize || field.autoCapitalize === 'sentences'}
                editable={!saving}
              />
              {fieldErrors[field.key] ? (
                <Text style={styles.fieldError}>{fieldErrors[field.key]}</Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
      },
      android: { elevation: 2 },
    }),
  },
  headerTitle: {
    ...typography.label,
    fontSize: 14,
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  headerAction: {
    ...typography.body,
    fontSize: 15,
    color: colors.textSecondary,
  },
  headerActionSave: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  headerActionDisabled: {
    opacity: 0.4,
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorBannerText: {
    ...typography.body,
    fontSize: 13,
    color: '#991B1B',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 80,
  },
  fieldRow: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    letterSpacing: 0.8,
  },
  fieldInput: {
    ...typography.body,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  fieldInputMultiline: {
    minHeight: 96,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },
  fieldInputError: {
    borderColor: '#EF4444',
  },
  fieldError: {
    ...typography.body,
    fontSize: 12,
    color: '#EF4444',
    marginTop: 4,
  },
});

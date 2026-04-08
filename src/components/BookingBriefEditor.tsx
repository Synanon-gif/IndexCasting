import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { showAppAlert } from '../utils/crossPlatformAlert';
import { updateBookingDetails } from '../services/calendarSupabase';
import {
  BOOKING_BRIEF_FIELD_KEYS,
  type BookingBriefFieldKey,
  type BookingBriefPartyRole,
  type BookingBriefFieldScope,
  buildBookingBriefDraft,
  mergeBookingBriefFromEditor,
  parseBookingBrief,
  type BookingBriefDraft,
} from '../utils/bookingBrief';

const LABEL_KEY: Record<BookingBriefFieldKey, keyof typeof uiCopy.bookingBrief> = {
  shoot_details: 'shootDetails',
  location: 'location',
  contact: 'contact',
  call_time: 'callTime',
  deliverables: 'deliverables',
};

function privateLabelForRole(role: BookingBriefPartyRole): string {
  switch (role) {
    case 'agency':
      return uiCopy.bookingBrief.visibilityPrivateAgency;
    case 'client':
      return uiCopy.bookingBrief.visibilityPrivateClient;
    case 'model':
      return uiCopy.bookingBrief.visibilityPrivateModel;
  }
}

export type BookingBriefEditorProps = {
  role: BookingBriefPartyRole;
  optionRequestId: string;
  /** Pass `calendar_entry.booking_details?.booking_brief` (or whole JSON subtree). */
  bookingBriefRaw: unknown;
  onAfterSave: () => void | Promise<void>;
};

const BookingBriefEditor: React.FC<BookingBriefEditorProps> = ({
  role,
  optionRequestId,
  bookingBriefRaw,
  onAfterSave,
}) => {
  const parsed = useMemo(() => parseBookingBrief(bookingBriefRaw) ?? {}, [bookingBriefRaw]);
  const serialized = useMemo(() => JSON.stringify(bookingBriefRaw ?? null), [bookingBriefRaw]);

  const [draft, setDraft] = useState<BookingBriefDraft>(() =>
    buildBookingBriefDraft(parseBookingBrief(bookingBriefRaw) ?? {}, role),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = parseBookingBrief(bookingBriefRaw) ?? {};
    setDraft(buildBookingBriefDraft(next, role));
  }, [serialized, role]); // eslint-disable-line react-hooks/exhaustive-deps -- serialized tracks bookingBriefRaw content

  const editableKeys = useMemo(
    () => BOOKING_BRIEF_FIELD_KEYS.filter((k) => draft[k] !== undefined),
    [draft],
  );

  const setField = useCallback((key: BookingBriefFieldKey, patch: { text?: string; scope?: BookingBriefFieldScope }) => {
    setDraft((prev) => {
      const cur = prev[key] ?? { text: '', scope: 'shared' as const };
      return {
        ...prev,
        [key]: {
          text: patch.text !== undefined ? patch.text : cur.text,
          scope: patch.scope !== undefined ? patch.scope : cur.scope,
        },
      };
    });
  }, []);

  const onSave = useCallback(async () => {
    setSaving(true);
    try {
      const existing = parseBookingBrief(bookingBriefRaw) ?? {};
      const merged = mergeBookingBriefFromEditor(existing, draft, role);
      const ok = await updateBookingDetails(optionRequestId, { booking_brief: merged }, role);
      if (ok) {
        await onAfterSave();
        showAppAlert(uiCopy.common.success, uiCopy.bookingBrief.briefSaved);
      } else {
        showAppAlert(uiCopy.common.error, uiCopy.bookingBrief.briefSaveFailed);
      }
    } finally {
      setSaving(false);
    }
  }, [bookingBriefRaw, draft, optionRequestId, role, onAfterSave]);

  if (editableKeys.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{uiCopy.bookingBrief.sectionTitle}</Text>
      <Text style={styles.meta}>{uiCopy.bookingBrief.sectionIntro}</Text>
      <Text style={[styles.meta, { marginBottom: spacing.sm }]}>{uiCopy.bookingBrief.emptyHint}</Text>

      {editableKeys.map((key) => {
        const row = draft[key]!;
        const saved = parsed[key];
        const badge =
          saved?.text?.trim() && (saved.scope === 'shared' || saved.scope === role)
            ? saved.scope === 'shared'
              ? uiCopy.bookingBrief.badgeShared
              : uiCopy.bookingBrief.badgePrivate
            : null;

        return (
          <View key={key} style={styles.fieldBlock}>
            <View style={styles.labelRow}>
              <Text style={styles.fieldLabel}>{uiCopy.bookingBrief[LABEL_KEY[key]]}</Text>
              {badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                onPress={() => setField(key, { scope: 'shared' })}
                style={[styles.togglePill, row.scope === 'shared' && styles.togglePillActive]}
              >
                <Text style={[styles.toggleText, row.scope === 'shared' && styles.toggleTextActive]}>
                  {uiCopy.bookingBrief.visibilityEveryone}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setField(key, { scope: role })}
                style={[styles.togglePill, row.scope === role && styles.togglePillActive]}
              >
                <Text style={[styles.toggleText, row.scope === role && styles.toggleTextActive]}>
                  {privateLabelForRole(role)}
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              value={row.text}
              onChangeText={(t) => setField(key, { text: t })}
              multiline
              placeholder={uiCopy.bookingBrief.placeholder}
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
          </View>
        );
      })}

      <TouchableOpacity
        onPress={() => void onSave()}
        style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}
        disabled={saving}
      >
        <Text style={styles.saveBtnLabel}>
          {saving ? uiCopy.bookingBrief.savingBrief : uiCopy.bookingBrief.saveBrief}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    ...typography.label,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  meta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  fieldBlock: {
    marginBottom: spacing.md,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  fieldLabel: {
    ...typography.label,
    fontSize: 12,
    color: colors.textPrimary,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  badgeText: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  toggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  togglePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  togglePillActive: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.border,
  },
  toggleText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  toggleTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  input: {
    ...typography.body,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    textAlignVertical: 'top',
  },
  saveBtn: {
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.textPrimary,
  },
  saveBtnLabel: {
    ...typography.label,
    color: colors.surface,
    fontSize: 12,
  },
});

export default BookingBriefEditor;

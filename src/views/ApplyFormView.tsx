/**
 * Öffentliche Apply-Page für neue Models.
 * Schlichtes, High-End-Formular – auf dem Smartphone so einfach wie ein Instagram-Post.
 */
import React, { useRef, useState, useEffect, createElement } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { addApplication } from '../store/applicationsStore';
import { uploadApplicationImage, APPLICATION_UPLOAD_SESSION_KEY } from '../services/applicationsSupabase';
import { convertHeicToJpegIfNeeded } from '../services/imageUtils';
import { useAuth } from '../context/AuthContext';
import { splitProfileDisplayName } from '../utils/applicantNameFromProfile';
import { uiCopy } from '../constants/uiCopy';
import { FILTER_COUNTRIES, ETHNICITY_OPTIONS } from '../utils/modelFilters';
import { confirmImageRights } from '../services/gdprComplianceSupabase';

type ImageSlot = 'closeUp' | 'fullBody' | 'profile';

function dataURLtoBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8[i] = bstr.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

const SLOT_LABELS: Record<ImageSlot, string> = {
  closeUp: 'Close-up',
  fullBody: 'Full body',
  profile: 'Profile',
};

export const ApplyFormView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const auth = useAuth();
  const applicantUserId = auth?.user?.id ?? '';
  const profile = auth?.profile ?? null;
  const nameLocked = Boolean(applicantUserId);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [city, setCity] = useState('');
  const [gender, setGender] = useState<string>('');
  const [hairColor, setHairColor] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [countryQuery, setCountryQuery] = useState('');
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [ethnicity, setEthnicity] = useState('');
  const [ethnicityDropdownOpen, setEthnicityDropdownOpen] = useState(false);
  const [instagramLink, setInstagramLink] = useState('');
  const [images, setImages] = useState<Record<ImageSlot, string>>({
    closeUp: '',
    fullBody: '',
    profile: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageRightsConfirmed, setImageRightsConfirmed] = useState(false);
  const fileInputRefs = useRef<Record<ImageSlot, HTMLInputElement | null>>({
    closeUp: null,
    fullBody: null,
    profile: null,
  });

  const fileRefs = useRef<Record<ImageSlot, File | null>>({ closeUp: null, fullBody: null, profile: null });

  useEffect(() => {
    if (!nameLocked || !profile?.display_name) return;
    const { firstName, lastName } = splitProfileDisplayName(profile.display_name);
    setFirstName(firstName);
    setLastName(lastName);
  }, [nameLocked, profile?.display_name]);

  const assignImageFile = async (slot: ImageSlot, file: File) => {
    if (!file.type.startsWith('image/')) return;
    const converted = await convertHeicToJpegIfNeeded(file);
    const asFile = converted instanceof File ? converted : new File([converted], file.name.replace(/\.hei[cf]$/i, '.jpg'), { type: converted.type });
    fileRefs.current[slot] = asFile;
    if (Platform.OS === 'web') {
      const objectUrl = URL.createObjectURL(asFile);
      setImages((prev) => ({ ...prev, [slot]: objectUrl }));
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        setImages((prev) => ({ ...prev, [slot]: reader.result as string }));
      };
      reader.readAsDataURL(asFile);
    }
  };

  const handleFileChange = (slot: ImageSlot) => (e: { target?: { files?: FileList | null } }) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    void assignImageFile(slot, file);
  };

  const triggerFileInput = (slot: ImageSlot) => {
    if (Platform.OS === 'web' && fileInputRefs.current[slot]) {
      fileInputRefs.current[slot]?.click();
    }
  };

  const renderFileInput = (slot: ImageSlot) => {
    if (Platform.OS !== 'web') return null;
    return createElement('input', {
      ref: (el: HTMLInputElement | null) => { fileInputRefs.current[slot] = el; },
      type: 'file',
      accept: 'image/*',
      style: { display: 'none' },
      onChange: handleFileChange(slot),
    });
  };

  /** Web: ohne dragover/drop + preventDefault navigiert der Browser zur Bild-URL statt ins Feld. */
  const wrapImageDropZone = (slot: ImageSlot, node: React.ReactElement) => {
    if (Platform.OS !== 'web') return node;
    return createElement(
      'div',
      {
        style: { alignSelf: 'stretch' },
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const file = e.dataTransfer?.files?.[0];
          if (file) void assignImageFile(slot, file);
        },
      },
      node,
    );
  };

  const handleSubmit = async () => {
    setError(null);
    const ageNum = parseInt(age, 10);
    const heightNum = parseInt(height, 10);
    if (!firstName.trim()) {
      setError(
        nameLocked ? uiCopy.apply.displayNameMissing : uiCopy.apply.firstNameRequired,
      );
      return;
    }
    if (!nameLocked && !lastName.trim()) {
      setError(uiCopy.apply.nameRequired);
      return;
    }
    if (!age || isNaN(ageNum) || ageNum < 14 || ageNum > 99) {
      setError('Please enter a valid age.');
      return;
    }
    if (!height || isNaN(heightNum) || heightNum < 140 || heightNum > 220) {
      setError('Please enter a valid height (cm).');
      return;
    }
    if (!city.trim()) {
      setError('Please enter your city.');
      return;
    }
    if (!gender) {
      setError('Please select Female or Male.');
      return;
    }
    if (!countryCode) {
      setError('Please select your country.');
      return;
    }
    if (!applicantUserId) {
      setError('Please log in as a model to submit an application.');
      return;
    }
    const hasImages = Object.values(fileRefs.current).some(Boolean) ||
      Object.values(images).some((u) => u.startsWith('data:image'));
    if (hasImages && !imageRightsConfirmed) {
      setError('Please confirm you have all necessary rights and consents to share the uploaded photos.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const imageUrls: Record<string, string> = {};
      if (hasImages && applicantUserId) {
        const rights = await confirmImageRights({
          userId:     applicantUserId,
          modelId:    null,
          sessionKey: APPLICATION_UPLOAD_SESSION_KEY,
        });
        if (!rights.ok) {
          setError(uiCopy.legal.imageRightsConfirmationFailed);
          return;
        }
      }
      const uploadFailures: ImageSlot[] = [];
      for (const slot of (Object.keys(SLOT_LABELS) as ImageSlot[])) {
        const file = fileRefs.current[slot];
        const dataUrl = images[slot];
        if (file) {
          const url = await uploadApplicationImage(file, slot);
          if (url) imageUrls[slot] = url;
          else uploadFailures.push(slot);
        } else if (dataUrl && dataUrl.startsWith('data:image')) {
          const blob = dataURLtoBlob(dataUrl);
          const url = await uploadApplicationImage(blob, slot);
          if (url) imageUrls[slot] = url;
          else uploadFailures.push(slot);
        }
      }
      if (uploadFailures.length > 0) {
        setError(
          `${uiCopy.validation.uploadFailed} (${uploadFailures.map((s) => SLOT_LABELS[s]).join(', ')})`,
        );
        return;
      }

      const result = await addApplication({
        applicantUserId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        age: ageNum,
        height: heightNum,
        gender: (gender === 'female' || gender === 'male' ? gender : '') as 'female' | 'male' | 'diverse' | '',
        hairColor: hairColor.trim(),
        city: city.trim(),
        countryCode: countryCode || undefined,
        ethnicity: ethnicity || undefined,
        instagramLink: instagramLink.trim(),
        images: imageUrls,
      });
      if (result) {
        setSubmitted(true);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } catch (err) {
      console.error('Apply submit error:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.brand}>INDEX CASTING</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.successTitle}>Application submitted</Text>
          <Text style={styles.successCopy}>
            Thank you. We will get back to you.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.brand}>Apply</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Application</Text>
        <Text style={styles.subtitle}>Send us your details and photos.</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Applicant name</Text>
          {nameLocked ? (
            <View style={styles.readonlyBox}>
              <Text style={styles.readonlyValue}>
                {[firstName, lastName].filter(Boolean).join(' ') || '—'}
              </Text>
              <Text style={styles.readonlyHint}>{uiCopy.apply.nameLockedHint}</Text>
            </View>
          ) : (
            <>
              <View style={styles.row}>
                <View style={[styles.field, styles.half, { marginBottom: 0 }]}>
                  <Text style={styles.label}>First name</Text>
                  <TextInput
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="First name"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.input}
                    autoCapitalize="words"
                  />
                </View>
                <View style={[styles.field, styles.half, { marginBottom: 0 }]}>
                  <Text style={styles.label}>Last name</Text>
                  <TextInput
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Last name"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.input}
                    autoCapitalize="words"
                  />
                </View>
              </View>
            </>
          )}
        </View>
        <View style={styles.row}>
          <View style={[styles.field, styles.half]}>
            <Text style={styles.label}>Age</Text>
            <TextInput
              value={age}
              onChangeText={setAge}
              placeholder="e.g. 22"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              keyboardType="number-pad"
            />
          </View>
          <View style={[styles.field, styles.half]}>
            <Text style={styles.label}>Height (cm)</Text>
            <TextInput
              value={height}
              onChangeText={setHeight}
              placeholder="e.g. 178"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              keyboardType="number-pad"
            />
          </View>
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>City</Text>
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="City"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
          />
        </View>
        {/* Sex — Female / Male only (mandatory, matches filter logic) */}
        <View style={styles.field}>
          <Text style={styles.label}>Sex <Text style={{ color: colors.buttonSkipRed }}>*</Text></Text>
          <View style={styles.row}>
            {(['female', 'male'] as const).map((g) => (
              <TouchableOpacity
                key={g}
                style={[styles.genderPill, gender === g && styles.genderPillActive]}
                onPress={() => setGender(g)}
              >
                <Text style={[styles.genderPillLabel, gender === g && styles.genderPillLabelActive]}>
                  {g === 'female' ? 'Female' : 'Male'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Country — mandatory, searchable dropdown matching FILTER_COUNTRIES */}
        <View style={styles.field}>
          <Text style={styles.label}>Country <Text style={{ color: colors.buttonSkipRed }}>*</Text></Text>
          {countryCode ? (
            <View style={styles.row}>
              <View style={styles.chip}>
                <Text style={styles.chipLabel}>
                  {FILTER_COUNTRIES.find((c) => c.code === countryCode)?.label ?? countryCode}
                </Text>
                <TouchableOpacity
                  onPress={() => { setCountryCode(''); setCountryQuery(''); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.chipRemove}>×</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View>
              <TextInput
                value={countryQuery}
                onChangeText={(v) => { setCountryQuery(v); setCountryDropdownOpen(true); setEthnicityDropdownOpen(false); }}
                onFocus={() => { setCountryDropdownOpen(true); setEthnicityDropdownOpen(false); }}
                placeholder="Search country…"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
              />
              {countryDropdownOpen && (
                <View style={styles.dropdown}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator style={{ maxHeight: 180 }}>
                    {FILTER_COUNTRIES
                      .filter((c) => !countryQuery.trim() || c.label.toLowerCase().includes(countryQuery.toLowerCase()) || c.code.toLowerCase().includes(countryQuery.toLowerCase()))
                      .map((c, i, arr) => (
                        <TouchableOpacity
                          key={c.code}
                          style={[styles.dropdownItem, i < arr.length - 1 && styles.dropdownItemBorder]}
                          onPress={() => { setCountryCode(c.code); setCountryQuery(''); setCountryDropdownOpen(false); }}
                        >
                          <Text style={styles.dropdownItemText}>{c.label}</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Ethnicity — optional, single-select dropdown matching ETHNICITY_OPTIONS */}
        <View style={styles.field}>
          <Text style={styles.label}>Ethnicity <Text style={{ ...typography.label, color: colors.textSecondary }}>(optional)</Text></Text>
          {ethnicity ? (
            <View style={styles.row}>
              <View style={styles.chip}>
                <Text style={styles.chipLabel}>{ethnicity}</Text>
                <TouchableOpacity
                  onPress={() => setEthnicity('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.chipRemove}>×</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View>
              <TouchableOpacity
                style={[styles.input, { justifyContent: 'center' }]}
                onPress={() => { setEthnicityDropdownOpen((o) => !o); setCountryDropdownOpen(false); }}
              >
                <Text style={{ ...typography.body, color: colors.textSecondary }}>Select ethnicity…</Text>
              </TouchableOpacity>
              {ethnicityDropdownOpen && (
                <View style={styles.dropdown}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator style={{ maxHeight: 180 }}>
                    {ETHNICITY_OPTIONS.map((eth, i) => (
                      <TouchableOpacity
                        key={eth}
                        style={[styles.dropdownItem, i < ETHNICITY_OPTIONS.length - 1 && styles.dropdownItemBorder]}
                        onPress={() => { setEthnicity(eth); setEthnicityDropdownOpen(false); }}
                      >
                        <Text style={styles.dropdownItemText}>{eth}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Hair color */}
        <View style={styles.field}>
          <Text style={styles.label}>Hair color</Text>
          <TextInput
            value={hairColor}
            onChangeText={setHairColor}
            placeholder="e.g. Dark Brown"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Instagram link</Text>
          <TextInput
            value={instagramLink}
            onChangeText={setInstagramLink}
            placeholder="https://instagram.com/..."
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            autoCapitalize="none"
            keyboardType="url"
          />
        </View>

        <Text style={styles.sectionLabel}>Photos</Text>
        {(Object.keys(SLOT_LABELS) as ImageSlot[]).map((slot) => (
          <View key={slot} style={styles.imageField}>
            <Text style={styles.label}>{SLOT_LABELS[slot]}</Text>
            {renderFileInput(slot)}
            {wrapImageDropZone(
              slot,
              <TouchableOpacity
                style={styles.imageBox}
                onPress={() => triggerFileInput(slot)}
                activeOpacity={0.8}
              >
                {images[slot] ? (
                  <Image source={{ uri: images[slot] }} style={styles.previewImage} resizeMode="cover" />
                ) : (
                  <Text style={styles.imagePlaceholder}>+ Photo</Text>
                )}
              </TouchableOpacity>,
            )}
          </View>
        ))}

        <TouchableOpacity
          style={styles.rightsCheckRow}
          onPress={() => setImageRightsConfirmed((v) => !v)}
          accessibilityRole="checkbox"
        >
          <View style={[styles.rightsCheckbox, imageRightsConfirmed && styles.rightsCheckboxChecked]}>
            {imageRightsConfirmed && <Text style={styles.rightsCheckmark}>✓</Text>}
          </View>
          <Text style={styles.rightsCheckLabel}>
            I confirm I have all necessary rights and consents to share these photos as part of my application.
          </Text>
        </TouchableOpacity>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.surface} size="small" />
          ) : (
            <Text style={styles.submitLabel}>Submit</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: spacing.xl * 2 }} />
      </ScrollView>
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
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    flexGrow: 1,
    paddingBottom: spacing.xl * 3,
  },
  readonlyBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: colors.surface,
  },
  readonlyValue: {
    ...typography.body,
    color: colors.textPrimary,
  },
  readonlyHint: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 14,
  },
  title: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  field: {
    marginBottom: spacing.md,
  },
  half: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    ...typography.body,
    color: colors.textPrimary,
  },
  genderPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  genderPillActive: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.textPrimary,
  },
  genderPillLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  genderPillLabelActive: {
    color: colors.surface,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.textPrimary,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.surface,
  },
  chipRemove: {
    ...typography.label,
    fontSize: 14,
    color: colors.surface,
    lineHeight: 16,
  },
  dropdown: {
    marginTop: spacing.xs,
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 16,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  dropdownItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownItemText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  imageField: {
    marginBottom: spacing.md,
  },
  imageBox: {
    height: 160,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    ...typography.body,
    color: colors.textSecondary,
  },
  errorText: {
    ...typography.body,
    color: colors.buttonSkipRed,
    marginBottom: spacing.sm,
  },
  submitButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.textPrimary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  rightsCheckRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
    width: '100%',
  },
  rightsCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  rightsCheckboxChecked: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  rightsCheckmark: { color: colors.surface, fontSize: 12, fontWeight: '700' },
  rightsCheckLabel: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 16,
  },
  submitLabel: {
    ...typography.label,
    color: colors.surface,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  successTitle: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  successCopy: {
    ...typography.body,
    color: colors.textSecondary,
  },
});

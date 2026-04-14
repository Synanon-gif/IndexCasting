import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import type { PdfModelInput } from '../utils/pdfExport';

type PdfExportModalProps = {
  visible: boolean;
  onClose: () => void;
  models: PdfModelInput[];
  entityName: string;
};

export function PdfExportModal({ visible, onClose, models, entityName }: PdfExportModalProps) {
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 600;

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(models.map((_, i) => String(i))),
  );
  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelected(new Set(models.map((_, i) => String(i))));
      setFeedback(null);
      setIsError(false);
      setGenerating(false);
    }
  }, [visible, models]);

  const allSelected = selected.size === models.length;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(models.map((_, i) => String(i))));
    }
  }, [allSelected, models]);

  const toggle = useCallback((idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = String(idx);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectedModels = useMemo(
    () => models.filter((_, i) => selected.has(String(i))),
    [models, selected],
  );

  const copy = uiCopy.pdfExport;

  const handleDownload = useCallback(async () => {
    if (selectedModels.length === 0) return;
    setGenerating(true);
    setFeedback(null);
    setIsError(false);
    try {
      const { generateModelsPdf, downloadBlob } = await import('../utils/pdfExport');
      const blob = await generateModelsPdf(selectedModels, entityName);
      const safeName = entityName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Export';
      downloadBlob(blob, `IndexCasting-${safeName}.pdf`);
      setFeedback(copy.success);
      setIsError(false);
      setTimeout(() => {
        setFeedback(null);
        onClose();
      }, 1200);
    } catch (e) {
      console.error('[PdfExportModal] generation failed:', e);
      setFeedback(copy.errorGeneric);
      setIsError(true);
    } finally {
      setGenerating(false);
    }
  }, [selectedModels, entityName, onClose, copy.success, copy.errorGeneric]);

  if (Platform.OS !== 'web') return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          <Text style={styles.title}>{copy.title}</Text>

          <TouchableOpacity onPress={toggleAll} style={styles.selectAllRow}>
            <View style={[styles.checkbox, allSelected && styles.checkboxChecked]}>
              {allSelected ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.selectAllLabel}>
              {allSelected ? copy.deselectAll : copy.selectAll}
            </Text>
          </TouchableOpacity>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {models.map((m, i) => {
              const isSelected = selected.has(String(i));
              return (
                <TouchableOpacity
                  key={`${m.name}-${i}`}
                  style={styles.row}
                  onPress={() => toggle(i)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                    {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {m.name || 'Unknown'}
                    </Text>
                    {m.city ? (
                      <Text style={styles.rowCity} numberOfLines={1}>
                        {m.city}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.rowImageCount}>{m.imageUrls.length} img</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {feedback ? (
            <Text style={[styles.feedback, isError && styles.feedbackError]}>{feedback}</Text>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={generating}>
              <Text style={styles.cancelLabel}>{copy.cancelButton}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.downloadBtn,
                (selected.size === 0 || generating) && styles.downloadBtnDisabled,
              ]}
              onPress={handleDownload}
              disabled={selected.size === 0 || generating}
            >
              {generating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.downloadLabel}>{copy.downloadButton}</Text>
              )}
            </TouchableOpacity>
          </View>

          {generating ? <Text style={styles.generatingHint}>{copy.generating}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    width: 420,
    maxHeight: '80%',
  },
  cardMobile: {
    width: '92%',
    maxWidth: 420,
  },
  title: {
    fontFamily: typography.fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  selectAllLabel: {
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
  list: {
    maxHeight: 320,
  },
  listContent: {
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  rowInfo: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  rowName: {
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  rowCity: {
    fontFamily: typography.fontFamily,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rowImageCount: {
    fontFamily: typography.fontFamily,
    fontSize: 11,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
  feedback: {
    fontFamily: typography.fontFamily,
    fontSize: 13,
    color: colors.accentGreen,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  feedbackError: {
    color: colors.buttonSkipRed,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelLabel: {
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  downloadBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    backgroundColor: colors.accent,
    minWidth: 100,
    alignItems: 'center',
  },
  downloadBtnDisabled: {
    opacity: 0.4,
  },
  downloadLabel: {
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  generatingHint: {
    fontFamily: typography.fontFamily,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});

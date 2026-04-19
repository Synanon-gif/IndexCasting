import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import { TrustPageLayout, TrustSection } from './TrustPageLayout';

type Row = { name: string; purpose: string; region: string; dpa: string };

const rows: Row[] = [
  {
    name: uiCopy.trust.subSupabaseName,
    purpose: uiCopy.trust.subSupabasePurpose,
    region: uiCopy.trust.subSupabaseRegion,
    dpa: uiCopy.trust.subSupabaseDpa,
  },
  {
    name: uiCopy.trust.subVercelName,
    purpose: uiCopy.trust.subVercelPurpose,
    region: uiCopy.trust.subVercelRegion,
    dpa: uiCopy.trust.subVercelDpa,
  },
  {
    name: uiCopy.trust.subStripeName,
    purpose: uiCopy.trust.subStripePurpose,
    region: uiCopy.trust.subStripeRegion,
    dpa: uiCopy.trust.subStripeDpa,
  },
  {
    name: uiCopy.trust.subResendName,
    purpose: uiCopy.trust.subResendPurpose,
    region: uiCopy.trust.subResendRegion,
    dpa: uiCopy.trust.subResendDpa,
  },
];

export const TrustSubprocessorsView: React.FC = () => (
  <TrustPageLayout
    title={uiCopy.trust.subTitle}
    backTo="/trust"
    backLabel={uiCopy.trust.backToTrust}
  >
    <Text style={styles.intro}>{uiCopy.trust.subIntro}</Text>

    <View style={styles.tableHeader}>
      <Text style={[styles.cell, styles.cellHeader, styles.colName]}>
        {uiCopy.trust.subTableNameHeader}
      </Text>
      <Text style={[styles.cell, styles.cellHeader, styles.colPurpose]}>
        {uiCopy.trust.subTablePurposeHeader}
      </Text>
      <Text style={[styles.cell, styles.cellHeader, styles.colRegion]}>
        {uiCopy.trust.subTableRegionHeader}
      </Text>
      <Text style={[styles.cell, styles.cellHeader, styles.colDpa]}>
        {uiCopy.trust.subTableDpaHeader}
      </Text>
    </View>
    {rows.map((r) => (
      <View key={r.name} style={styles.tableRow}>
        <Text style={[styles.cell, styles.cellName, styles.colName]}>{r.name}</Text>
        <Text style={[styles.cell, styles.colPurpose]}>{r.purpose}</Text>
        <Text style={[styles.cell, styles.colRegion]}>{r.region}</Text>
        <Text style={[styles.cell, styles.colDpa]}>{r.dpa}</Text>
      </View>
    ))}

    <Text style={styles.optionalNotice}>{uiCopy.trust.subOptionalNotice}</Text>

    <TrustSection heading={uiCopy.trust.subChangesTitle} body={uiCopy.trust.subChangesBody} />
  </TrustPageLayout>
);

const styles = StyleSheet.create({
  intro: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginTop: spacing.sm,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  cell: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    paddingHorizontal: spacing.xs,
  },
  cellHeader: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
  },
  cellName: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  colName: { flex: 2 },
  colPurpose: { flex: 4 },
  colRegion: { flex: 2 },
  colDpa: { flex: 2 },
  optionalNotice: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
});

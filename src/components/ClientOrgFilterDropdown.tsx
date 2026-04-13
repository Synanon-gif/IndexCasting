import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Modal,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import type { ClientAssignmentFlag } from '../services/clientAssignmentsSupabase';

export type ClientOrgFilterOption = {
  id: string;
  label: string;
  assignment?: ClientAssignmentFlag;
  threadCount?: number;
};

type Props = {
  options: ClientOrgFilterOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  currentUserId?: string | null;
};

export const ClientOrgFilterDropdown: React.FC<Props> = ({
  options,
  selectedId,
  onSelect,
  currentUserId,
}) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<View>(null);

  const copy = uiCopy.dashboard;
  const selectedLabel =
    selectedId === '__mine__'
      ? copy.orgFilterMyClients
      : selectedId === '__unassigned__'
        ? copy.orgFilterUnassigned
        : (options.find((o) => o.id === selectedId)?.label ?? copy.orgFilterAllClients);

  const handleSelect = useCallback(
    (id: string | null) => {
      onSelect(id);
      setOpen(false);
    },
    [onSelect],
  );

  const myClients = options.filter((o) => o.assignment?.assignedMemberUserId === currentUserId);
  const unassigned = options.filter((o) => !o.assignment?.assignedMemberUserId);

  const renderItems = () => (
    <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
      <TouchableOpacity
        style={[styles.item, !selectedId && styles.itemActive]}
        onPress={() => handleSelect(null)}
      >
        <Text style={[styles.itemLabel, !selectedId && styles.itemLabelActive]}>
          {copy.orgFilterAllClients}
        </Text>
      </TouchableOpacity>

      {currentUserId && myClients.length > 0 && (
        <TouchableOpacity
          style={[styles.item, selectedId === '__mine__' && styles.itemActive]}
          onPress={() => handleSelect('__mine__')}
        >
          <Text style={[styles.itemLabel, selectedId === '__mine__' && styles.itemLabelActive]}>
            {copy.orgFilterMyClients} ({myClients.length})
          </Text>
        </TouchableOpacity>
      )}

      {unassigned.length > 0 && (
        <TouchableOpacity
          style={[styles.item, selectedId === '__unassigned__' && styles.itemActive]}
          onPress={() => handleSelect('__unassigned__')}
        >
          <Text
            style={[styles.itemLabel, selectedId === '__unassigned__' && styles.itemLabelActive]}
          >
            {copy.orgFilterUnassigned} ({unassigned.length})
          </Text>
        </TouchableOpacity>
      )}

      {options.length > 0 && <View style={styles.separator} />}

      {options.map((o) => (
        <TouchableOpacity
          key={o.id}
          style={[styles.item, selectedId === o.id && styles.itemActive]}
          onPress={() => handleSelect(o.id)}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={[styles.itemLabel, selectedId === o.id && styles.itemLabelActive]}
              numberOfLines={1}
            >
              {o.label}
            </Text>
            {o.assignment && (
              <Text style={styles.assignmentMeta} numberOfLines={1}>
                {o.assignment.label}
                {o.assignment.assignedMemberName ? ` · ${o.assignment.assignedMemberName}` : ''}
              </Text>
            )}
          </View>
          {o.threadCount != null && o.threadCount > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{o.threadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      ))}

      {options.length === 0 && (
        <View style={styles.item}>
          <Text style={[styles.itemLabel, { color: colors.textSecondary }]}>
            {copy.orgFilterNoClients}
          </Text>
        </View>
      )}
    </ScrollView>
  );

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container} ref={buttonRef}>
        <TouchableOpacity
          style={styles.trigger}
          onPress={() => setOpen((p) => !p)}
          accessibilityRole="button"
          accessibilityLabel={`Filter: ${selectedLabel}`}
        >
          <Text style={styles.triggerLabel} numberOfLines={1}>
            {selectedLabel}
          </Text>
          <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {open && (
          <>
            <TouchableOpacity
              style={styles.webBackdrop}
              activeOpacity={1}
              onPress={() => setOpen(false)}
            />
            <View style={styles.webDropdown}>{renderItems()}</View>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Filter: ${selectedLabel}`}
      >
        <Text style={styles.triggerLabel} numberOfLines={1}>
          {selectedLabel}
        </Text>
        <Text style={styles.chevron}>▼</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.modalContent}>{renderItems()}</View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative' as const,
    zIndex: 100,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 140,
  },
  triggerLabel: {
    ...typography.label,
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 8,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  webBackdrop: {
    ...StyleSheet.absoluteFillObject,
    position: 'fixed' as unknown as undefined,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 98,
  },
  webDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    minWidth: 260,
    maxWidth: 360,
    maxHeight: 340,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginTop: 4,
    zIndex: 99,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.12)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
        elevation: 6,
      },
    }),
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalContent: {
    width: '90%',
    maxWidth: 360,
    maxHeight: '70%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  list: {
    maxHeight: 320,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemActive: {
    backgroundColor: '#f0efec',
  },
  itemLabel: {
    ...typography.label,
    fontSize: 13,
    color: colors.textPrimary,
  },
  itemLabelActive: {
    fontWeight: '700',
  },
  assignmentMeta: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 1,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  countBadge: {
    backgroundColor: '#dbeafe',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: spacing.sm,
  },
  countText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1d4ed8',
  },
});

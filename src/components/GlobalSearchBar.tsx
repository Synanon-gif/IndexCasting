/**
 * GlobalSearchBar
 *
 * Full-width debounced search bar that queries models, option requests, and
 * conversations via the search_global RPC (org-scoped, SECURITY DEFINER).
 * Shows results inline below the input; minimum 2 characters required.
 * Double-click safe: loading state disables re-triggering.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Pressable,
} from 'react-native';
import { colors, spacing } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { useDebounce } from '../utils/useDebounce';
import { searchGlobal, type GlobalSearchResult } from '../services/searchSupabase';

interface Props {
  orgId: string;
  onSelectModel?: (id: string) => void;
  onSelectConversation?: (id: string) => void;
  onSelectOption?: (id: string) => void;
}

export const GlobalSearchBar: React.FC<Props> = ({
  orgId,
  onSelectModel,
  onSelectConversation,
  onSelectOption,
}) => {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebounce(query, 300);
  const copy = uiCopy.dashboard;
  const reqRef = useRef(0);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResult(null);
      setLoading(false);
      return;
    }
    const id = ++reqRef.current;
    setLoading(true);
    try {
      const data = await searchGlobal(q, orgId);
      if (reqRef.current === id) setResult(data);
    } finally {
      if (reqRef.current === id) setLoading(false);
    }
  }, [orgId]);

  React.useEffect(() => {
    void search(debouncedQuery);
  }, [debouncedQuery, search]);

  const hasResults = result && (
    result.models.length > 0 ||
    result.option_requests.length > 0 ||
    result.conversations.length > 0
  );

  const clear = () => {
    setQuery('');
    setResult(null);
    setOpen(false);
  };

  return (
    <View style={styles.container}>
      {open && <Pressable style={styles.backdrop} onPress={clear} />}
      <View style={styles.inputRow}>
        <TextInput
          value={query}
          onChangeText={(v) => { setQuery(v); setOpen(true); }}
          placeholder={copy.searchPlaceholder}
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          onFocus={() => setOpen(true)}
          returnKeyType="search"
        />
        {loading && <ActivityIndicator size="small" color={colors.textSecondary} style={styles.spinner} />}
        {query.length > 0 && !loading && (
          <TouchableOpacity onPress={clear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.clearBtn}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {open && query.trim().length >= 2 && (
        <ScrollView style={styles.dropdown} keyboardShouldPersistTaps="handled">
          {!hasResults && !loading && (
            <Text style={styles.emptyText}>{copy.searchNoResults}</Text>
          )}

          {result && result.models.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{copy.searchResultsModels}</Text>
              {result.models.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.resultRow}
                  onPress={() => { onSelectModel?.(m.id); clear(); }}
                >
                  <Text style={styles.resultName}>{m.name}</Text>
                  {m.mediaslide_id ? (
                    <Text style={styles.resultMeta}>{m.mediaslide_id}</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {result && result.option_requests.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{copy.searchResultsOptions}</Text>
              {result.option_requests.map((o) => (
                <TouchableOpacity
                  key={o.id}
                  style={styles.resultRow}
                  onPress={() => { onSelectOption?.(o.id); clear(); }}
                >
                  <Text style={styles.resultName}>{o.model_name ?? '—'}</Text>
                  <Text style={styles.resultMeta}>{o.requested_date ?? ''}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {result && result.conversations.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{copy.searchResultsChats}</Text>
              {result.conversations.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.resultRow}
                  onPress={() => { onSelectConversation?.(c.id); clear(); }}
                >
                  <Text style={styles.resultName}>{c.title ?? 'Chat'}</Text>
                  {c.last_message ? (
                    <Text style={styles.resultMeta} numberOfLines={1}>{c.last_message}</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 100,
  },
  backdrop: {
    position: 'absolute',
    top: -9999,
    bottom: -9999,
    left: -9999,
    right: -9999,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    height: 36,
  },
  input: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    height: '100%',
  },
  spinner: {
    marginLeft: spacing.xs,
  },
  clearBtn: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  dropdown: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
    maxHeight: 320,
  },
  section: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  resultRow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm - 2,
  },
  resultName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  resultMeta: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    padding: spacing.md,
  },
});

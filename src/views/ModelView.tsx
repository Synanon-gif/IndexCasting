import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { ModelProfileScreen } from '../screens/ModelProfileScreen';
import { ModelApplicationsView } from './ModelApplicationsView';
import { getModelForUserFromSupabase } from '../services/modelsSupabase';
import { colors } from '../theme/theme';

type ModelViewProps = {
  onBackToRoleSelection: () => void;
  userId?: string | null;
};

export const ModelView: React.FC<ModelViewProps> = ({ onBackToRoleSelection, userId }) => {
  const [modelId, setModelId] = useState<string | null | 'loading'>('loading');

  useEffect(() => {
    if (!userId) {
      setModelId(null);
      return;
    }
    let cancelled = false;
    setModelId('loading');
    getModelForUserFromSupabase(userId).then((m) => {
      if (!cancelled) setModelId(m ? m.id : null);
    });
    return () => { cancelled = true; };
  }, [userId]);

  if (modelId === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  if (modelId === null && userId) {
    return (
      <ModelApplicationsView
        applicantUserId={userId}
        onBackToRoleSelection={onBackToRoleSelection}
      />
    );
  }

  return <ModelProfileScreen onBackToRoleSelection={onBackToRoleSelection} userId={userId ?? undefined} />;
};

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  loadingText: { marginTop: 8, fontSize: 12, color: colors.textSecondary },
});


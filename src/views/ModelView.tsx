import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { ModelProfileScreen } from '../screens/ModelProfileScreen';
import { ModelApplicationsView } from './ModelApplicationsView';
import { getModelForUserFromSupabase } from '../services/modelsSupabase';
import { colors } from '../theme/theme';

type ModelViewProps = {
  onBackToRoleSelection: () => void;
  /** Wenn gesetzt: echte Anmeldung; Model für User laden. Fehlt: Demo-Modus, direkt Profil. */
  userId?: string | null;
};

export const ModelView: React.FC<ModelViewProps> = ({ onBackToRoleSelection, userId }) => {
  const [modelId, setModelId] = useState<string | null | 'loading'>('loading');

  useEffect(() => {
    if (userId === undefined || userId === null) {
      setModelId('demo');
      return;
    }
    setModelId('loading');
    getModelForUserFromSupabase(userId).then((m) => setModelId(m ? m.id : null));
  }, [userId]);

  if (modelId === 'demo') {
    return <ModelProfileScreen onBackToRoleSelection={onBackToRoleSelection} />;
  }

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


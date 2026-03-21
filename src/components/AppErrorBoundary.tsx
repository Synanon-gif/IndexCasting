import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, ScrollView, Platform, TouchableOpacity, StyleSheet } from 'react-native';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Zeigt Render-Fehler direkt im UI (hilft, wenn der Screen nur weiß bleibt und die Konsole „leer“ wirkt).
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary]', error.message, error.stack, info.componentStack);
  }

  handleReload = (): void => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
    }
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      const msg = this.state.error.message || String(this.state.error);
      const stack = this.state.error.stack || '';
      return (
        <View style={styles.wrap}>
          <Text style={styles.title}>Die App ist abgestürzt (Render-Fehler)</Text>
          <Text style={styles.hint}>
            GitHub/Supabase sind dafür nicht die Ursache – hier steht der echte Fehler. Bei Web: Konsole mit F12 öffnen.
          </Text>
          <ScrollView style={styles.scroll}>
            <Text selectable style={styles.mono}>
              {msg}
              {stack ? `\n\n${stack}` : ''}
            </Text>
          </ScrollView>
          {Platform.OS === 'web' && (
            <TouchableOpacity style={styles.btn} onPress={this.handleReload}>
              <Text style={styles.btnLabel}>Seite neu laden</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: '#fdecea',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#b71c1c', marginBottom: 12 },
  hint: { fontSize: 14, color: '#333', marginBottom: 16, lineHeight: 20 },
  scroll: { maxHeight: 360, marginBottom: 16, backgroundColor: '#fff', padding: 12, borderRadius: 8 },
  mono: { fontSize: 12, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, color: '#111' },
  btn: { alignSelf: 'flex-start', backgroundColor: '#b71c1c', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  btnLabel: { color: '#fff', fontWeight: '600' },
});

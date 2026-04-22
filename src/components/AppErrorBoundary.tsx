import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, ScrollView, Platform, TouchableOpacity, StyleSheet } from 'react-native';
import { uiCopy } from '../constants/uiCopy';
import { logger } from '../utils/logger';

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Renders render errors in-app (helps when the screen stays blank). */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (__DEV__) {
      console.error('[AppErrorBoundary]', error.message, error.stack, info.componentStack);
    } else {
      console.error('[AppErrorBoundary] render error caught');
    }
    // Ship to observability backend (fire-and-forget; PII-redacted; throttled).
    // Hardening (2026-04, F11): nur EIN Sentry-Event pro Render-Crash.
    // Wir geben das echte Error-Objekt als `error` im Context mit — der
    // Logger-Forwarder routet das in `Sentry.captureException`, was den
    // Stacktrace sauber gruppiert. Ein zusätzlicher direkter
    // `Sentry.captureException`-Call würde dasselbe Crash zweimal melden.
    try {
      logger.fatal('AppErrorBoundary', error.message || 'render-error', {
        error,
        componentStack: info.componentStack ?? null,
        boundary: 'AppErrorBoundary',
      });
    } catch {
      // Logger must never break the boundary itself.
    }
  }

  handleReload = (): void => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
    }
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <View style={styles.wrap}>
          <Text style={styles.title}>{uiCopy.app.crashTitle}</Text>
          <Text style={styles.hint}>{uiCopy.app.crashBody}</Text>
          {__DEV__ && (
            <ScrollView style={styles.scroll}>
              <Text selectable style={styles.mono}>
                {this.state.error.message || String(this.state.error)}
                {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
              </Text>
            </ScrollView>
          )}
          {Platform.OS === 'web' && (
            <TouchableOpacity style={styles.btn} onPress={this.handleReload}>
              <Text style={styles.btnLabel}>{uiCopy.common.reloadPage}</Text>
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
  scroll: {
    maxHeight: 360,
    marginBottom: 16,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
  },
  mono: {
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    color: '#111',
  },
  btn: {
    alignSelf: 'flex-start',
    backgroundColor: '#b71c1c',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  btnLabel: { color: '#fff', fontWeight: '600' },
});

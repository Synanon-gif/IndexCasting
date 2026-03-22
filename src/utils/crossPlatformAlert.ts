import { Alert, Platform } from 'react-native';

/** Web: React Native Alert is unreliable; use window.alert so users always see errors. */
export function showAppAlert(title: string, message?: string): void {
  const body = message?.trim() ? `${title}\n\n${message}` : title;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(body);
    return;
  }
  Alert.alert(title, message);
}

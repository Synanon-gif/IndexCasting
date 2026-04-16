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

/** Web: window.confirm; Native: Alert with Cancel + destructive button. */
export function showConfirmAlert(
  title: string,
  message: string,
  onConfirm: () => void,
  confirmLabel = 'Confirm',
  onCancel?: () => void,
): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const body = message.trim() ? `${title}\n\n${message}` : title;
    if (window.confirm(body)) onConfirm();
    else onCancel?.();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: onCancel },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

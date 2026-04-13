import { Alert, Linking } from 'react-native';
import { uiCopy } from '../constants/uiCopy';

/** Opens a URL and shows a short alert if the OS cannot open it (no silent dead-click). */
export function openLinkWithFeedback(url: string): void {
  void Linking.openURL(url).catch(() => {
    Alert.alert(uiCopy.common.error, uiCopy.login.linkCouldNotOpen);
  });
}

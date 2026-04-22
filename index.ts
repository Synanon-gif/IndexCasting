import { registerRootComponent } from 'expo';

import { initSentry } from './src/observability/sentry';
import App from './App';

// Sentry zuerst initialisieren, damit Crashes beim App-Start erfasst werden.
// No-Op, wenn EXPO_PUBLIC_SENTRY_DSN fehlt oder env=development.
initSentry();

// Hilft beim Debug: Wenn diese Zeile in der Browser-Konsole fehlt, lädt das JS-Bundle nicht.
if (typeof __DEV__ !== 'undefined' && __DEV__ && typeof window !== 'undefined') {
  console.log('[IndexCasting] JS bundle loaded');
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

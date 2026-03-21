import { registerRootComponent } from 'expo';

import App from './App';

// Hilft beim Debug: Wenn diese Zeile in der Browser-Konsole fehlt, lädt das JS-Bundle nicht.
if (typeof __DEV__ !== 'undefined' && __DEV__ && typeof window !== 'undefined') {
  console.log('[IndexCasting] JS bundle loaded');
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

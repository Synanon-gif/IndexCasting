import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.castingindex.app',
  appName: 'Casting Index',
  webDir: 'dist',
  server: {
    // Allow live reload when serving from Expo dev server (optional)
    // url: 'http://localhost:8081',
    // cleartext: true,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;

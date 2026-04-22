// Sentry: Debug-IDs + Release-Konstanten fürs Web-Bundle, kein Session Replay.
// @see https://docs.sentry.io/platforms/react-native/manual-setup/expo/
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname, {
  includeWebReplay: false,
});

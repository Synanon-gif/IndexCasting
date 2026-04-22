/**
 * Jest stub: expo-constants ist im RN-Bundle ESM und kann von ts-jest nicht
 * direkt geladen werden. In Tests reicht ein leeres `expoConfig.extra`,
 * unsere Sentry-/Env-Reader fallen dann auf `process.env` zurück.
 */
module.exports = {
  __esModule: true,
  default: { expoConfig: { extra: {} } },
};

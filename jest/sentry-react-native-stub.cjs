/**
 * Jest stub: Sentry darf in Node/Jest nicht echt geladen werden (ESM-Bundle).
 * Alle Public-APIs sind sichere No-Ops — Tests prüfen die Scrubbing-Funktion
 * separat in src/observability/__tests__/sentry.scrub.test.ts mit `jest.mock`.
 */
module.exports = {
  init: () => {},
  captureException: () => {},
  captureMessage: () => {},
  addBreadcrumb: () => {},
  setTag: () => {},
  setTags: () => {},
  setUser: () => {},
  setExtra: () => {},
  setContext: () => {},
  withScope: (fn) => fn({ setTag: () => {}, setExtra: () => {}, setContext: () => {} }),
  getCurrentScope: () => ({ setTag: () => {}, setExtra: () => {}, setContext: () => {} }),
};

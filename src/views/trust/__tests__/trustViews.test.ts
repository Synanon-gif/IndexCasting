import { uiCopy } from '../../../constants/uiCopy';

/**
 * Contract tests for the public Trust Center copy.
 *
 * Each Trust Center page is a static layout that reads its visible strings
 * from `uiCopy.trust.*`. If a key disappears or is renamed, the corresponding
 * page renders an empty section silently — these tests fail loudly instead.
 *
 * Pure logic / contract tests (no react-native renderer) keep the suite fast
 * and avoid pulling RN testing infrastructure for what is essentially a
 * dictionary check. Routing is covered separately in
 * `src/utils/__tests__/publicLegalRoutes.test.ts`.
 */

const trust = uiCopy.trust as Record<string, string>;

function expectNonEmptyString(key: string): void {
  const v = trust[key];
  expect(typeof v).toBe('string');
  expect(v.trim().length).toBeGreaterThan(0);
}

describe('uiCopy.trust — shared chrome', () => {
  test.each([
    'lastUpdated',
    'backToHome',
    'backToTrust',
    'contactLabel',
    'contactEmail',
    'privacyEmail',
  ])('defines %s', (k) => expectNonEmptyString(k));

  test('contact emails look like emails', () => {
    expect(trust.contactEmail).toMatch(/@/);
    expect(trust.privacyEmail).toMatch(/@/);
  });
});

describe('uiCopy.trust — Trust Center overview', () => {
  test.each([
    'centerTitle',
    'centerSubtitle',
    'centerIntro',
    'cardSecurityTitle',
    'cardSecurityBody',
    'cardDpaTitle',
    'cardDpaBody',
    'cardSubprocessorsTitle',
    'cardSubprocessorsBody',
    'cardGdprTitle',
    'cardGdprBody',
    'cardIncidentTitle',
    'cardIncidentBody',
    'cardStatusTitle',
    'cardStatusBody',
  ])('defines %s', (k) => expectNonEmptyString(k));
});

describe('uiCopy.trust — Security page', () => {
  test.each([
    'securityTitle',
    'securityIntro',
    'securityArchTitle',
    'securityArchBody',
    'securityRlsTitle',
    'securityRlsBody',
    'securityAdminTitle',
    'securityAdminBody',
    'securityAuthTitle',
    'securityAuthBody',
    'securitySecretsTitle',
    'securitySecretsBody',
    'securityUploadsTitle',
    'securityUploadsBody',
    'securityVulnTitle',
    'securityVulnBody',
  ])('defines %s', (k) => expectNonEmptyString(k));
});

describe('uiCopy.trust — DPA page', () => {
  test.each([
    'dpaTitle',
    'dpaIntro',
    'dpaPartiesTitle',
    'dpaPartiesBody',
    'dpaScopeTitle',
    'dpaScopeBody',
    'dpaCategoriesTitle',
    'dpaCategoriesBody',
    'dpaDataTitle',
    'dpaDataBody',
    'dpaPurposesTitle',
    'dpaPurposesBody',
    'dpaRetentionTitle',
    'dpaRetentionBody',
    'dpaTomTitle',
    'dpaTomBody',
    'dpaTransfersTitle',
    'dpaTransfersBody',
    'dpaSubprocessorsTitle',
    'dpaSubprocessorsBody',
    'dpaRightsTitle',
    'dpaRightsBody',
  ])('defines %s', (k) => expectNonEmptyString(k));
});

describe('uiCopy.trust — Sub-processors page', () => {
  test.each([
    'subTitle',
    'subIntro',
    'subTableNameHeader',
    'subTablePurposeHeader',
    'subTableRegionHeader',
    'subTableDpaHeader',
    'subSupabaseName',
    'subSupabasePurpose',
    'subSupabaseRegion',
    'subSupabaseDpa',
    'subVercelName',
    'subVercelPurpose',
    'subVercelRegion',
    'subVercelDpa',
    'subStripeName',
    'subStripePurpose',
    'subStripeRegion',
    'subStripeDpa',
    'subResendName',
    'subResendPurpose',
    'subResendRegion',
    'subResendDpa',
    'subOptionalNotice',
    'subChangesTitle',
    'subChangesBody',
  ])('defines %s', (k) => expectNonEmptyString(k));
});

describe('uiCopy.trust — GDPR page', () => {
  test.each([
    'gdprTitle',
    'gdprIntro',
    'gdprAccessTitle',
    'gdprAccessBody',
    'gdprRectificationTitle',
    'gdprRectificationBody',
    'gdprErasureTitle',
    'gdprErasureBody',
    'gdprPortabilityTitle',
    'gdprPortabilityBody',
    'gdprObjectTitle',
    'gdprObjectBody',
    'gdprMinorsTitle',
    'gdprMinorsBody',
    'gdprContactTitle',
    'gdprContactBody',
  ])('defines %s', (k) => expectNonEmptyString(k));
});

describe('uiCopy.trust — Incident Response page', () => {
  test.each([
    'incidentTitle',
    'incidentIntro',
    'incidentDetectionTitle',
    'incidentDetectionBody',
    'incidentTriageTitle',
    'incidentTriageBody',
    'incidentContainTitle',
    'incidentContainBody',
    'incidentCommsTitle',
    'incidentCommsBody',
    'incidentReviewTitle',
    'incidentReviewBody',
    'incidentBreachTitle',
    'incidentBreachBody',
    'incidentReportTitle',
    'incidentReportBody',
  ])('defines %s', (k) => expectNonEmptyString(k));
});

describe('uiCopy.trust — Status page', () => {
  test.each([
    'statusTitle',
    'statusSubtitle',
    'statusOverallOk',
    'statusOverallDegraded',
    'statusOverallOutage',
    'statusOverallUnknown',
    'statusLastUpdated',
    'statusCheckHeader',
    'statusCheckStatus',
    'statusCheckLastRun',
    'statusLoadFailed',
    'statusLoading',
    'statusEmpty',
    'statusBackToTrust',
    'statusContactNote',
  ])('defines %s', (k) => expectNonEmptyString(k));
});

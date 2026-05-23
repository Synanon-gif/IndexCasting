/**
 * Regression fence: Org-chat related option requests + B2B invoice draft UX.
 * Do not remove or weaken without equivalent replacement tests.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../../..');

function readSrc(relativePath: string): string {
  const full = path.join(ROOT, relativePath);
  expect(fs.existsSync(full)).toBe(true);
  return fs.readFileSync(full, 'utf8');
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while (true) {
    const next = haystack.indexOf(needle, idx);
    if (next === -1) break;
    count += 1;
    idx = next + needle.length;
  }
  return count;
}

describe('B2B related requests — store regression guard', () => {
  it('creates booking card when agency_id is set even if country code is empty', () => {
    const src = readSrc('src/store/optionRequests.ts');
    const block = src.slice(
      src.indexOf('createBookingMessageInClientAgencyChat'),
      src.indexOf('addOptionSystemMessage', src.indexOf('createBookingMessageInClientAgencyChat')),
    );
    expect(block).toMatch(
      /if\s*\(\s*user\?\.\s*id\s*&&\s*organizationId\s*&&\s*result\.agency_id\s*\)/,
    );
    expect(block).not.toMatch(
      /if\s*\([^)]*bookingCountryCode[^)]*\)\s*\{[^}]*createBookingMessageInClientAgencyChat/s,
    );
  });
});

describe('B2B related requests — mobile + desktop UI regression guard', () => {
  it('OrgMessengerInline merges orphan related requests into the message timeline', () => {
    const src = readSrc('src/components/OrgMessengerInline.tsx');
    expect(src).toMatch(/relatedOptionRequests\?:\s*B2bRelatedOptionRequestSummary\[\]/);
    expect(src).toMatch(/buildB2bOrgChatTimeline/);
    expect(src).toMatch(/chatTimeline\.map/);
    expect(src).toMatch(/kind === 'related_request'/);
    expect(src).toMatch(/relatedOptionRequestWorkflowBadge/);
    expect(src).toMatch(/workflowBadge\.label/);
    expect(src).toMatch(/onOpenRelatedRequest\(req\.id\)/);
    expect(src).toMatch(/onOpenRelatedRequest \? relatedOptionRequests : \[\]/);
    expect(src).toMatch(/uiCopy\.b2bChat\.openRelatedRequest/);
    expect(src).not.toMatch(/relatedRequestsStrip/);
    expect(src).not.toMatch(/relatedRequestsScrollView/);
    expect(src).not.toMatch(/relatedRequestsTitle/);
    expect(src).not.toMatch(/horizontal.*Related requests/is);
  });

  it('ClientWebApp wires related requests for B2B org chat (web split + mobile fullscreen)', () => {
    const src = readSrc('src/web/ClientWebApp.tsx');
    expect(src).toMatch(/filterRelatedOptionRequestsForB2BConversation/);
    expect(src).toMatch(/relatedOptionRequests=\{relatedOptionRequestsForChat\}/);
    expect(src).toMatch(/onOpenRelatedRequest=\{onOpenRelatedRequest\}/);
    expect(src).toMatch(/b2bWebSplit/);
    expect(
      countOccurrences(src, 'relatedOptionRequests={relatedOptionRequestsForChat}'),
    ).toBeGreaterThanOrEqual(1);
  });

  it('AgencyControllerView wires related requests on mobile fullscreen and desktop split', () => {
    const src = readSrc('src/views/AgencyControllerView.tsx');
    expect(src).toMatch(/filterRelatedOptionRequestsForB2BConversation/);
    expect(src).toMatch(/relatedOptionRequestsForActiveB2bChat/);
    expect(
      countOccurrences(src, 'relatedOptionRequests={relatedOptionRequestsForActiveB2bChat}'),
    ).toBeGreaterThanOrEqual(3);
    expect(countOccurrences(src, 'onOpenRelatedRequest={(optionRequestId)')).toBeGreaterThanOrEqual(
      3,
    );
    expect(src).toMatch(/b2bChatFullscreenActive/);
    expect(src).toMatch(/CHAT_MESSENGER_FLEX/);
  });

  it('b2bRelatedOptionRequests exports timeline builder used by OrgMessengerInline', () => {
    const util = readSrc('src/utils/b2bRelatedOptionRequests.ts');
    expect(util).toMatch(/export function buildB2bOrgChatTimeline/);
    expect(util).toMatch(/export function relatedOptionRequestWorkflowBadge/);
    expect(util).toMatch(/optionRequestWorkflowBadge/);
    expect(util).toMatch(/message_type !== 'booking'/);
    expect(util).toMatch(/metadata\?\.option_request_id/);
    expect(util).toMatch(/sortKey - b\.sortKey/);
  });

  it('negotiationWorkflowLabel is the canonical option-request badge source', () => {
    const src = readSrc('src/utils/negotiationWorkflowLabel.ts');
    expect(src).toMatch(/export function optionRequestWorkflowBadge/);
    expect(src).toMatch(/case 'Option confirmed':/);
    expect(src).toMatch(/optionRequestStatusOptionConfirmed/);
  });
});

describe('B2B related requests — filter regression guard', () => {
  it('dedupes by option_request id and scopes by org pair', () => {
    const src = readSrc('src/utils/b2bRelatedOptionRequests.ts');
    expect(src).toMatch(/seen\.has\(r\.id\)/);
    expect(src).toMatch(/clientOrganizationId !== clientOrg/);
    expect(src).toMatch(/agencyOrganizationId !== agencyOrg/);
    expect(src).toMatch(/buildB2bOrgChatTimeline/);
    expect(src).not.toMatch(/conversation_id/);
    expect(src).not.toMatch(/seen\.has\([^)]*conversation/);
  });
});

describe('Invoice overview draft UX — regression guard', () => {
  it('InvoiceOverviewPanel opens existing InvoiceDraftEditor for editable system drafts', () => {
    const src = readSrc('src/components/billing/InvoiceOverviewPanel.tsx');
    expect(src).toMatch(/import \{ InvoiceDraftEditor \}/);
    expect(src).toMatch(/openDraftId/);
    expect(src).toMatch(/isSystemInvoiceDraftEditableByAgency/);
    expect(src).toMatch(/setOpenDraftId\(row\.sourceId\)/);
    expect(src).toMatch(/onOpenDraft=\{/);
  });

  it('manual invoice draft copy is distinct from B2B system drafts', () => {
    const src = readSrc('src/constants/uiCopy.ts');
    expect(src).toMatch(/manual invoice draft/i);
    expect(src).toMatch(/manualDraftHint/);
    expect(src).toMatch(/openSystemDraft/);
  });

  it('agency editable directions exclude platform_to_agency', () => {
    const src = readSrc('src/utils/invoiceOverviewDraftActions.ts');
    expect(src).toMatch(/agency_to_client/);
    expect(src).not.toMatch(/platform_to_agency/);
  });
});

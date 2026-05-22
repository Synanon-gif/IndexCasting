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
  it('OrgMessengerInline renders horizontal related-request strip above composer', () => {
    const src = readSrc('src/components/OrgMessengerInline.tsx');
    expect(src).toMatch(/relatedOptionRequests\?:\s*B2bRelatedOptionRequestSummary\[\]/);
    expect(src).toMatch(/horizontal/);
    expect(src).toMatch(/keyboardShouldPersistTaps="handled"/);
    expect(src).toMatch(/relatedRequestsScrollView/);
    expect(src).toMatch(/minWidth:\s*0/);
    expect(src).toMatch(/onOpenRelatedRequest\(req\.id\)/);
  });

  it('ClientWebApp wires related requests for B2B org chat (web split + mobile fullscreen)', () => {
    const src = readSrc('src/web/ClientWebApp.tsx');
    expect(src).toMatch(/filterRelatedOptionRequestsForB2BConversation/);
    expect(src).toMatch(/relatedOptionRequests=\{relatedOptionRequestsForChat\}/);
    expect(src).toMatch(/onOpenRelatedRequest=\{onOpenRelatedRequest\}/);
    expect(src).toMatch(/b2bWebSplit/);
  });

  it('AgencyControllerView wires related requests on mobile fullscreen and desktop split', () => {
    const src = readSrc('src/views/AgencyControllerView.tsx');
    expect(src).toMatch(/relatedOptionRequestsForActiveB2bChat/);
    expect(
      countOccurrences(src, 'relatedOptionRequests={relatedOptionRequestsForActiveB2bChat}'),
    ).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/b2bChatFullscreenActive/);
    expect(src).toMatch(/CHAT_MESSENGER_FLEX/);
  });
});

describe('B2B related requests — filter regression guard', () => {
  it('dedupes by option_request id and scopes by org pair', () => {
    const src = readSrc('src/utils/b2bRelatedOptionRequests.ts');
    expect(src).toMatch(/seen\.has\(r\.id\)/);
    expect(src).toMatch(/clientOrganizationId !== clientOrg/);
    expect(src).toMatch(/agencyOrganizationId !== agencyOrg/);
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

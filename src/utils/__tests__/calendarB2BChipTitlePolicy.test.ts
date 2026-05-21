/**
 * Regression guards for B2B calendar chip titles (Model — Agency / Model — Client).
 * Display titles must stay separate from color/projection/dedupe/routing.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { AgencyCalendarItem, CalendarEntry } from '../../services/calendarSupabase';
import type { SupabaseOptionRequest } from '../../services/optionRequestsSupabase';
import {
  buildEventsByDateFromUnifiedRows,
  buildUnifiedAgencyCalendarRows,
  dedupeUnifiedRowsByOptionRequest,
} from '../agencyCalendarUnified';
import { buildTimelineEventsFromUnifiedRows } from '../calendarUnifiedTimeline';
import { resolveCalendarRowOpenAction } from '../calendarRowOpenAction';
import { B2B_CALENDAR_CHIP_TITLE_SEPARATOR } from '../calendarEventDisplayTitle';
import { uiCopy } from '../../constants/uiCopy';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(REPO_ROOT, 'src');

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(SRC, relativePath), 'utf8');
}

function minimalOption(overrides: Partial<SupabaseOptionRequest>): SupabaseOptionRequest {
  const now = new Date().toISOString();
  return {
    id: 'opt-1',
    client_id: 'c1',
    model_id: 'm1',
    agency_id: 'a1',
    requested_date: '2026-04-15',
    status: 'in_negotiation',
    project_id: null,
    client_name: 'Client 3',
    model_name: 'RÉMI LOVISOLO',
    job_description: null,
    proposed_price: 100,
    agency_counter_price: null,
    client_price_status: 'pending',
    final_status: 'option_confirmed',
    request_type: 'option',
    currency: 'EUR',
    start_time: null,
    end_time: null,
    model_approval: 'approved',
    model_approved_at: null,
    model_account_linked: true,
    booker_id: null,
    organization_id: 'org-client',
    agency_organization_id: 'Poetry of People',
    client_organization_id: 'Client 3',
    client_organization_name: 'Client 3',
    agency_organization_name: 'Poetry of People',
    created_by: null,
    agency_assignee_user_id: null,
    created_at: now,
    updated_at: now,
    is_agency_only: false,
    ...overrides,
  };
}

function calendarEntry(overrides: Partial<CalendarEntry>): CalendarEntry {
  const now = new Date().toISOString();
  return {
    id: 'ce-1',
    model_id: 'm1',
    date: '2026-04-15',
    start_time: null,
    end_time: null,
    title: 'Option – Client 3',
    entry_type: 'option',
    status: 'tentative',
    booking_id: null,
    note: null,
    created_at: now,
    option_request_id: 'opt-1',
    ...overrides,
  };
}

function itemByOptionId(items: AgencyCalendarItem[]): Map<string, AgencyCalendarItem> {
  return new Map(items.map((i) => [i.option.id, i]));
}

describe('B2B calendar chip title policy — wiring', () => {
  it('ClientWebApp passes viewerRole client to buildUnifiedAgencyCalendarRows', () => {
    const text = readSrc('web/ClientWebApp.tsx');
    expect(text).toMatch(
      /buildUnifiedAgencyCalendarRows\s*\([\s\S]*?\{\s*viewerRole:\s*['"]client['"]\s*\}/,
    );
  });

  it('AgencyControllerView passes viewerRole agency to buildUnifiedAgencyCalendarRows', () => {
    const text = readSrc('views/AgencyControllerView.tsx');
    expect(text).toMatch(
      /buildUnifiedAgencyCalendarRows\s*\([\s\S]*?\{\s*viewerRole:\s*['"]agency['"]\s*\}/,
    );
  });

  it('resolveB2BCalendarChipTitle is only used from agencyCalendarUnified in production code', () => {
    const allowed = new Set([
      path.join(SRC, 'utils/calendarEventDisplayTitle.ts'),
      path.join(SRC, 'utils/agencyCalendarUnified.ts'),
    ]);
    const violations: string[] = [];

    function walk(dir: string): void {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          if (name === 'node_modules' || name === 'dist' || name === '.expo') continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(name) && !full.includes(`${path.sep}__tests__${path.sep}`)) {
          const text = fs.readFileSync(full, 'utf8');
          if (/\bresolveB2BCalendarChipTitle\b/.test(text) && !allowed.has(path.normalize(full))) {
            violations.push(path.relative(REPO_ROOT, full));
          }
        }
      }
    }

    walk(SRC);
    expect(violations).toEqual([]);
  });
});

describe('B2B calendar chip title policy — display vs canonical split', () => {
  const optId = 'opt-parity';
  const opt = minimalOption({ id: optId });
  const item: AgencyCalendarItem = {
    option: opt,
    calendar_entry: calendarEntry({ option_request_id: optId, title: 'Option – Client 3' }),
  };
  const map = itemByOptionId([item]);

  it('role-aware titles differ from legacy DB title but colors stay identical (month grid)', () => {
    const legacy = buildUnifiedAgencyCalendarRows([item], [], [], {}, map);
    const client = buildUnifiedAgencyCalendarRows([item], [], [], {}, map, {
      viewerRole: 'client',
    });
    const agency = buildUnifiedAgencyCalendarRows([item], [], [], {}, map, {
      viewerRole: 'agency',
    });

    const legacyEv = buildEventsByDateFromUnifiedRows(legacy)['2026-04-15']?.[0];
    const clientEv = buildEventsByDateFromUnifiedRows(client)['2026-04-15']?.[0];
    const agencyEv = buildEventsByDateFromUnifiedRows(agency)['2026-04-15']?.[0];

    expect(legacyEv?.title).toBe('Option – Client 3');
    expect(clientEv?.title).toBe(
      `RÉMI LOVISOLO${B2B_CALENDAR_CHIP_TITLE_SEPARATOR}Poetry of People`,
    );
    expect(agencyEv?.title).toBe(`RÉMI LOVISOLO${B2B_CALENDAR_CHIP_TITLE_SEPARATOR}Client 3`);

    expect(clientEv?.color).toBe(legacyEv?.color);
    expect(agencyEv?.color).toBe(legacyEv?.color);
    expect(clientEv?.optionRequestId).toBe(optId);
  });

  it('role-aware titles do not change timeline block colors (week/day)', () => {
    const legacy = buildUnifiedAgencyCalendarRows([item], [], [], {}, map);
    const client = buildUnifiedAgencyCalendarRows([item], [], [], {}, map, {
      viewerRole: 'client',
    });
    const labels = uiCopy.calendar.projectionBadge;

    const legacyBlock = buildTimelineEventsFromUnifiedRows(legacy, 'client', labels)[0];
    const clientBlock = buildTimelineEventsFromUnifiedRows(client, 'client', labels)[0];

    expect(clientBlock.title).not.toBe(legacyBlock.title);
    expect(clientBlock.color).toBe(legacyBlock.color);
    expect(clientBlock.unifiedRowId).toBe(legacyBlock.unifiedRowId);
  });

  it('dedupe still suppresses duplicate booking when option row has role-aware title', () => {
    const beEntry: CalendarEntry = {
      id: 'be:be-1',
      model_id: 'm1',
      date: '2026-04-15',
      start_time: null,
      end_time: null,
      title: 'Client 3 – job',
      entry_type: 'booking',
      status: 'booked',
      booking_id: null,
      note: null,
      created_at: new Date().toISOString(),
      option_request_id: optId,
    };

    const unified = buildUnifiedAgencyCalendarRows([item], [beEntry], [], {}, map, {
      viewerRole: 'client',
    });
    const deduped = dedupeUnifiedRowsByOptionRequest(unified);

    expect(unified.some((r) => r.kind === 'option')).toBe(true);
    expect(unified.some((r) => r.kind === 'booking')).toBe(true);
    expect(deduped.filter((r) => r.kind === 'booking')).toHaveLength(0);
    expect(deduped.filter((r) => r.kind === 'option')).toHaveLength(1);
    expect(deduped[0]?.title).toContain('RÉMI LOVISOLO');
  });

  it('open action routing uses row.item/entry ids, not display title', () => {
    const rows = buildUnifiedAgencyCalendarRows([item], [], [], {}, map, { viewerRole: 'client' });
    const row = rows[0];
    expect(row.kind).toBe('option');
    if (row.kind !== 'option') return;

    const action = resolveCalendarRowOpenAction(row, map);
    expect(action).toEqual({ type: 'openDetails', item });
    expect(row.title).toContain('RÉMI LOVISOLO');
    expect(row.title).not.toBe('Option – Client 3');
  });
});

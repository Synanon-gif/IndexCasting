import { supabase } from '../../lib/supabase';
import { uiCopy } from '../constants/uiCopy';
import { createNotifications } from './notificationsSupabase';
import { logAction } from '../utils/logAction';
import { logger } from '../utils/logger';

/** Alle Felder der booking_events-Tabelle — kein SELECT * mehr. */
const BOOKING_EVENT_SELECT =
  'id, model_id, client_org_id, agency_org_id, date, type, status, title, note, source_option_request_id, created_by, created_at, updated_at, fee_total, commission_rate, commission_amount, currency, project_id' as const;

/**
 * Booking Events – single source of truth for the booking lifecycle.
 * Table: booking_events (created in migration_system_hardening.sql)
 *
 * Lifecycle:
 *   pending → agency_accepted → model_confirmed → completed
 *                            ↓
 *                         cancelled
 */

export type BookingEventType = 'option' | 'job' | 'casting';

export type BookingEventStatus =
  | 'pending'
  | 'agency_accepted'
  | 'model_confirmed'
  | 'completed'
  | 'cancelled';

export type BookingEvent = {
  id: string;
  model_id: string;
  client_org_id: string | null;
  agency_org_id: string | null;
  date: string;
  type: BookingEventType;
  status: BookingEventStatus;
  title: string | null;
  note: string | null;
  source_option_request_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Financial fields (nullable; populated when a booking is financially confirmed). Legacy rows may omit these. */
  fee_total?: number | null;
  commission_rate?: number | null;
  commission_amount?: number | null;
  currency?: string | null;
  project_id?: string | null;
};

export type CreateBookingEventParams = {
  model_id: string;
  client_org_id?: string | null;
  agency_org_id?: string | null;
  date: string;
  type: BookingEventType;
  title?: string | null;
  note?: string | null;
  source_option_request_id?: string | null;
  /** Optional financial fields — consolidates legacy bookings table. */
  fee_total?: number | null;
  commission_rate?: number | null;
  project_id?: string | null;
  currency?: string | null;
};

export async function createBookingEvent(
  params: CreateBookingEventParams,
): Promise<BookingEvent | null> {
  try {
    const { data: user } = await supabase.auth.getUser();
    const commissionAmount =
      params.fee_total != null && params.commission_rate != null
        ? (params.fee_total * params.commission_rate) / 100
        : null;

    const { data, error } = await supabase
      .from('booking_events')
      .insert({
        model_id: params.model_id,
        client_org_id: params.client_org_id ?? null,
        agency_org_id: params.agency_org_id ?? null,
        date: params.date,
        type: params.type,
        status: 'pending' as BookingEventStatus,
        title: params.title ?? null,
        note: params.note ?? null,
        source_option_request_id: params.source_option_request_id ?? null,
        created_by: user.user?.id ?? null,
        fee_total: params.fee_total ?? null,
        commission_rate: params.commission_rate ?? null,
        commission_amount: commissionAmount,
        currency: params.currency ?? 'EUR',
        project_id: params.project_id ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('createBookingEvent error:', error);
      logger.error('bookingEvents', 'createBookingEvent insert failed', {
        message: error.message,
        code: (error as { code?: string }).code,
        type: params.type,
      });
      return null;
    }
    const created = data as BookingEvent;
    const bookingOrgId = created.agency_org_id ?? created.client_org_id;
    logAction(bookingOrgId, 'createBookingEvent', {
      type: 'booking',
      action: 'booking_created',
      entityId: created.id,
      newData: { type: created.type, model_id: created.model_id },
    });
    return created;
  } catch (e) {
    console.error('createBookingEvent exception:', e);
    return null;
  }
}

/** Valid status transitions for enforcement on the client side. */
const ALLOWED_TRANSITIONS: Record<BookingEventStatus, BookingEventStatus[]> = {
  pending: ['agency_accepted', 'cancelled'],
  agency_accepted: ['model_confirmed', 'cancelled'],
  model_confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export async function updateBookingEventStatus(
  id: string,
  newStatus: BookingEventStatus,
): Promise<{ ok: boolean; message?: string }> {
  try {
    // Fetch full booking data upfront so we can pass it to notifications
    // without a second DB round-trip (eliminates the getBookingEventById call
    // that was previously inside notifyBookingStatusChange).
    const { data: current, error: fetchError } = await supabase
      .from('booking_events')
      .select(BOOKING_EVENT_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (fetchError) {
      console.error('updateBookingEventStatus fetch error:', fetchError);
      return { ok: false, message: uiCopy.bookingStatus.updateFailed };
    }
    if (!current) {
      return { ok: false, message: uiCopy.bookingStatus.updateFailed };
    }

    const currentStatus = current.status as BookingEventStatus;
    const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(newStatus)) {
      return {
        ok: false,
        message: `Cannot transition from "${currentStatus}" to "${newStatus}".`,
      };
    }

    // Optimistic lock: only update if the status has not changed since we fetched it.
    // Without this guard two concurrent callers could race past the ALLOWED_TRANSITIONS
    // check and both write conflicting states (last-write-wins without error).
    const { data: updated, error } = await supabase
      .from('booking_events')
      .update({ status: newStatus })
      .eq('id', id)
      .eq('status', currentStatus)
      .select('id');

    if (error) {
      console.error('updateBookingEventStatus update error:', error);
      logger.error('bookingEvents', 'updateBookingEventStatus update failed', {
        message: error.message,
        code: (error as { code?: string }).code,
        from: currentStatus,
        to: newStatus,
      });
      return { ok: false, message: uiCopy.bookingStatus.updateFailed };
    }
    if (!updated || updated.length === 0) {
      // Another caller already changed the status; surface this as a conflict.
      return { ok: false, message: uiCopy.bookingStatus.updateFailed };
    }

    // Fire-and-forget notifications after successful transition.
    // Pass the already-fetched booking data to avoid a redundant DB round-trip.
    if (newStatus === 'agency_accepted' || newStatus === 'model_confirmed') {
      void notifyBookingStatusChange(current as BookingEvent, newStatus);
    }

    const bk = current as BookingEvent;
    const auditOrgId = bk.agency_org_id ?? bk.client_org_id;
    const auditAction =
      newStatus === 'cancelled'
        ? 'booking_cancelled'
        : newStatus === 'agency_accepted'
          ? 'booking_agency_accepted'
          : newStatus === 'model_confirmed'
            ? 'booking_model_confirmed'
            : newStatus === 'completed'
              ? 'booking_completed'
              : 'booking_confirmed';
    logAction(auditOrgId, 'updateBookingEventStatus', {
      type: 'booking',
      action: auditAction,
      entityId: id,
      newData: { status: newStatus },
      oldData: { status: currentStatus },
    });

    return { ok: true };
  } catch (e) {
    console.error('updateBookingEventStatus exception:', e);
    return { ok: false, message: uiCopy.bookingStatus.updateFailed };
  }
}

export type BookingEventsQueryOpts = {
  /** Inclusive lower bound (YYYY-MM-DD). Defaults to 90 days ago. */
  startDate?: string;
  /** Inclusive upper bound (YYYY-MM-DD). Defaults to 365 days from today. */
  endDate?: string;
  /** Max rows. Defaults to 500. */
  limit?: number;
};

/**
 * Returns booking events for a model within an optional date window.
 * Bounded by default to prevent full-table scans at scale.
 */
export async function getBookingEventsForModel(
  modelId: string,
  opts?: BookingEventsQueryOpts,
): Promise<BookingEvent[]> {
  try {
    const today = new Date();
    const start =
      opts?.startDate ?? new Date(today.getTime() - 90 * 86400000).toISOString().slice(0, 10);
    const end =
      opts?.endDate ?? new Date(today.getTime() + 365 * 86400000).toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('booking_events')
      .select(BOOKING_EVENT_SELECT)
      .eq('model_id', modelId)
      .neq('status', 'cancelled')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true })
      .limit(opts?.limit ?? 500);

    if (error) {
      console.error('getBookingEventsForModel error:', error);
      return [];
    }
    return (data ?? []) as BookingEvent[];
  } catch (e) {
    console.error('getBookingEventsForModel exception:', e);
    return [];
  }
}

/**
 * Returns booking events for an org within an optional date window.
 * Bounded by default to prevent full-table scans at scale.
 */
export async function getBookingEventsForOrg(
  orgId: string,
  role: 'agency' | 'client',
  opts?: BookingEventsQueryOpts,
): Promise<BookingEvent[]> {
  try {
    const today = new Date();
    const start =
      opts?.startDate ?? new Date(today.getTime() - 90 * 86400000).toISOString().slice(0, 10);
    const end =
      opts?.endDate ?? new Date(today.getTime() + 365 * 86400000).toISOString().slice(0, 10);
    const column = role === 'agency' ? 'agency_org_id' : 'client_org_id';

    const { data, error } = await supabase
      .from('booking_events')
      .select(BOOKING_EVENT_SELECT)
      .eq(column, orgId)
      .neq('status', 'cancelled')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true })
      .limit(opts?.limit ?? 500);

    if (error) {
      console.error(`getBookingEventsForOrg (${role}) error:`, error);
      return [];
    }
    return (data ?? []) as BookingEvent[];
  } catch (e) {
    console.error('getBookingEventsForOrg exception:', e);
    return [];
  }
}

/** Fetch a single booking event by ID. */
export async function getBookingEventById(id: string): Promise<BookingEvent | null> {
  try {
    const { data, error } = await supabase
      .from('booking_events')
      .select(BOOKING_EVENT_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('getBookingEventById error:', error);
      return null;
    }
    return (data ?? null) as BookingEvent | null;
  } catch (e) {
    console.error('getBookingEventById exception:', e);
    return null;
  }
}

/** Get all events for a date range (for calendar view merging). */
export async function getBookingEventsInRange(params: {
  orgId: string;
  role: 'agency' | 'client';
  startDate: string;
  endDate: string;
}): Promise<BookingEvent[]> {
  try {
    const column = params.role === 'agency' ? 'agency_org_id' : 'client_org_id';
    const { data, error } = await supabase
      .from('booking_events')
      .select(BOOKING_EVENT_SELECT)
      .eq(column, params.orgId)
      .neq('status', 'cancelled')
      .gte('date', params.startDate)
      .lte('date', params.endDate)
      .order('date', { ascending: true })
      .limit(500);

    if (error) {
      console.error('getBookingEventsInRange error:', error);
      return [];
    }
    return (data ?? []) as BookingEvent[];
  } catch (e) {
    console.error('getBookingEventsInRange exception:', e);
    return [];
  }
}

/**
 * Erstellt ein booking_event NUR wenn die Buchung vollständig bestätigt ist.
 * Guard: model_account_linked = false (Agency reicht) ODER model_approval = 'approved'.
 * Gibt null zurück wenn die Voraussetzungen nicht erfüllt sind (kein Fehler).
 */
export async function createConfirmedBookingEvent(
  params: CreateBookingEventParams & {
    modelAccountLinked: boolean;
    modelApproval: 'pending' | 'approved' | 'rejected';
  },
): Promise<BookingEvent | null> {
  const { modelAccountLinked, modelApproval, ...eventParams } = params;

  const isConfirmed = !modelAccountLinked || modelApproval === 'approved';

  if (!isConfirmed) {
    console.info('createConfirmedBookingEvent: skipped – awaiting model confirmation', {
      modelAccountLinked,
      modelApproval,
    });
    return null;
  }

  return createBookingEvent(eventParams);
}

/**
 * Sends notifications to the appropriate parties when a booking changes status.
 * Accepts the booking object directly to avoid a redundant DB fetch.
 *
 * agency_accepted  → notify client org + model user
 * model_confirmed  → notify agency org + client org
 */
async function notifyBookingStatusChange(
  booking: BookingEvent,
  newStatus: 'agency_accepted' | 'model_confirmed',
): Promise<void> {
  try {
    if (newStatus === 'agency_accepted') {
      const notifications = [];
      if (booking.client_org_id) {
        notifications.push({
          organization_id: booking.client_org_id,
          type: 'booking_accepted',
          title: uiCopy.notifications.bookingAccepted.title,
          message: uiCopy.notifications.bookingAccepted.message,
          metadata: { booking_id: booking.id },
        });
      }
      // Notify the model's linked user if available
      if (booking.model_id) {
        const { data: modelRow } = await supabase
          .from('models')
          .select('user_id')
          .eq('id', booking.model_id)
          .maybeSingle();
        const userId = (modelRow as { user_id?: string | null } | null)?.user_id;
        if (userId) {
          notifications.push({
            user_id: userId,
            type: 'booking_accepted',
            title: uiCopy.notifications.bookingAccepted.title,
            message: uiCopy.notifications.bookingAccepted.message,
            metadata: { booking_id: booking.id },
          });
        }
      }
      await createNotifications(notifications);
    }

    if (newStatus === 'model_confirmed') {
      const notifications = [];
      if (booking.agency_org_id) {
        notifications.push({
          organization_id: booking.agency_org_id,
          type: 'model_confirmed',
          title: uiCopy.notifications.modelConfirmed.title,
          message: uiCopy.notifications.modelConfirmed.message,
          metadata: { booking_id: booking.id },
        });
      }
      if (booking.client_org_id) {
        notifications.push({
          organization_id: booking.client_org_id,
          type: 'model_confirmed',
          title: uiCopy.notifications.modelConfirmed.title,
          message: uiCopy.notifications.modelConfirmed.message,
          metadata: { booking_id: booking.id },
        });
      }
      await createNotifications(notifications);
    }
  } catch (e) {
    console.error('notifyBookingStatusChange exception:', e);
  }
}

/** Human-readable label for a booking status. */
export function bookingStatusLabel(status: BookingEventStatus): string {
  const map: Record<BookingEventStatus, string> = {
    pending: uiCopy.bookingStatus.pending,
    agency_accepted: uiCopy.bookingStatus.agencyAccepted,
    model_confirmed: uiCopy.bookingStatus.modelConfirmed,
    completed: uiCopy.bookingStatus.completed,
    cancelled: uiCopy.bookingStatus.cancelled,
  };
  return map[status] ?? status;
}

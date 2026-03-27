import { supabase } from '../../lib/supabase';
import { uiCopy } from '../constants/uiCopy';
import { createNotifications } from './notificationsSupabase';

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
};

export async function createBookingEvent(
  params: CreateBookingEventParams,
): Promise<BookingEvent | null> {
  try {
    const { data: user } = await supabase.auth.getUser();
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
      })
      .select()
      .single();

    if (error) {
      console.error('createBookingEvent error:', error);
      return null;
    }
    return data as BookingEvent;
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
    const { data: current, error: fetchError } = await supabase
      .from('booking_events')
      .select('status')
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

    const { error } = await supabase
      .from('booking_events')
      .update({ status: newStatus })
      .eq('id', id);

    if (error) {
      console.error('updateBookingEventStatus update error:', error);
      return { ok: false, message: uiCopy.bookingStatus.updateFailed };
    }

    // Fire-and-forget notifications after successful transition
    if (newStatus === 'agency_accepted' || newStatus === 'model_confirmed') {
      void notifyBookingStatusChange(id, newStatus);
    }

    return { ok: true };
  } catch (e) {
    console.error('updateBookingEventStatus exception:', e);
    return { ok: false, message: uiCopy.bookingStatus.updateFailed };
  }
}

export async function getBookingEventsForModel(modelId: string): Promise<BookingEvent[]> {
  try {
    const { data, error } = await supabase
      .from('booking_events')
      .select('*')
      .eq('model_id', modelId)
      .order('date', { ascending: true });

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

export async function getBookingEventsForOrg(
  orgId: string,
  role: 'agency' | 'client',
): Promise<BookingEvent[]> {
  try {
    const column = role === 'agency' ? 'agency_org_id' : 'client_org_id';
    const { data, error } = await supabase
      .from('booking_events')
      .select('*')
      .eq(column, orgId)
      .order('date', { ascending: true });

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
      .select('*')
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
      .select('*')
      .eq(column, params.orgId)
      .gte('date', params.startDate)
      .lte('date', params.endDate)
      .order('date', { ascending: true });

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

  const isConfirmed =
    !modelAccountLinked || modelApproval === 'approved';

  if (!isConfirmed) {
    console.info(
      'createConfirmedBookingEvent: skipped – awaiting model confirmation',
      { modelAccountLinked, modelApproval },
    );
    return null;
  }

  return createBookingEvent(eventParams);
}

/**
 * Sends notifications to the appropriate parties when a booking changes status.
 *
 * agency_accepted  → notify client org + model user
 * model_confirmed  → notify agency org + client org
 */
async function notifyBookingStatusChange(
  bookingId: string,
  newStatus: 'agency_accepted' | 'model_confirmed',
): Promise<void> {
  try {
    const booking = await getBookingEventById(bookingId);
    if (!booking) return;

    if (newStatus === 'agency_accepted') {
      const notifications = [];
      if (booking.client_org_id) {
        notifications.push({
          organization_id: booking.client_org_id,
          type: 'booking_accepted',
          title: uiCopy.notifications.bookingAccepted.title,
          message: uiCopy.notifications.bookingAccepted.message,
          metadata: { booking_id: bookingId },
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
            metadata: { booking_id: bookingId },
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
          metadata: { booking_id: bookingId },
        });
      }
      if (booking.client_org_id) {
        notifications.push({
          organization_id: booking.client_org_id,
          type: 'model_confirmed',
          title: uiCopy.notifications.modelConfirmed.title,
          message: uiCopy.notifications.modelConfirmed.message,
          metadata: { booking_id: bookingId },
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

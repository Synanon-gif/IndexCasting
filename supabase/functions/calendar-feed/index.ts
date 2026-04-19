/**
 * calendar-feed Edge Function
 *
 * Private ICS subscription URL (Google Calendar / Apple Calendar).
 * Query: ?token=<plaintext_token_from_rotate_calendar_feed_token>
 *
 * Deploy: supabase functions deploy calendar-feed --no-verify-jwt
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Feed JSON is produced by get_calendar_feed_payload → calendar_export_events_json (priorities
 * and dedupe: supabase/migrations/20260901_calendar_export_events_json_include_booking_events.sql,
 * mirrored in src/constants/calendarSourcePriority.ts).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildIcsCalendar, icsEventsFromExportPayload } from './ics.ts';
import { withObservability } from '../_shared/logger.ts';

const ALLOWED_ORIGINS = [
  'https://index-casting.com',
  'https://www.index-casting.com',
  'https://indexcasting.com',
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

Deno.serve(withObservability('calendar-feed', async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[calendar-feed] Missing env');
      return new Response('Service unavailable', {
        status: 503,
        headers: corsHeaders,
      });
    }

    const url = new URL(req.url);
    const token = url.searchParams.get('token')?.trim() ?? '';

    if (!token || token.length < 16) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await adminClient.rpc('get_calendar_feed_payload', {
      p_token: token,
    });

    if (error) {
      console.error('[calendar-feed] rpc error:', error.message);
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    const events = icsEventsFromExportPayload(data as unknown);
    const ics = buildIcsCalendar(events, { calName: 'IndexCasting' });

    return new Response(ics, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (e) {
    console.error('[calendar-feed] exception:', e);
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
}));

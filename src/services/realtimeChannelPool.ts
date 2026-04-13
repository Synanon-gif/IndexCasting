/**
 * Realtime Channel Pool
 *
 * Problem: Every subscribeToConversation() / subscribeToOptionMessages() /
 * subscribeToThreadMessages() call creates a new Supabase WebSocket channel.
 * At 100k simultaneous users each viewing a chat = 100k open channels → Supabase
 * plan limit exceeded, connection timeouts, cascading failures.
 *
 * Solution: Reference-counted LRU pool.
 *   - MAX_CHANNELS: hard cap on concurrent open channels per client.
 *   - Multiple callers for the same key share one channel (reference-counted).
 *   - When the last subscriber of a channel unsubscribes, the channel is NOT
 *     closed immediately — it stays open for IDLE_EVICT_MS in case the user
 *     navigates back quickly (avoids reconnect churn).
 *   - When the pool is full, the oldest idle channel is evicted immediately.
 *   - If no idle channel exists (all active), the LRU active channel is evicted.
 */

import { supabase } from '../../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Synthetic payload dispatched to all callbacks of a channel that is forcibly
 * evicted from the pool (because the pool is full and no idle slot is available).
 * Consumers can inspect payload.type === 'CHANNEL_EVICTED' and trigger a
 * re-subscribe or show a "Reconnecting…" indicator.
 */
export type ChannelEvictedPayload = {
  type: 'CHANNEL_EVICTED';
  key: string;
};

/**
 * Max concurrent open Supabase Realtime channels per client session.
 * Bei 100k Usern mit mehreren parallelen Chat-Fenstern (Messenger +
 * Option-Chat + Recruiting) reichen 25 nicht mehr aus. 50 deckt
 * typische Multi-Tab-Sessions ohne Plan-Limit zu reißen.
 */
const MAX_CHANNELS = 50;

/**
 * Idle-Timeout: 30s statt 20s — gibt mehr Spielraum bei schnellen
 * Navigation-Sequenzen (Tab-Wechsel zwischen Chats).
 */
const IDLE_EVICT_MS = 30_000;

type DispatchFn = (payload: unknown) => void;

type PoolEntry = {
  channel: RealtimeChannel;
  /** All currently registered callbacks for this channel. */
  callbacks: Set<DispatchFn>;
  refCount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Insertion order for LRU eviction. */
  createdAt: number;
};

// Module-level singleton pool — shared across all chat services.
const pool = new Map<string, PoolEntry>();

function evictOne(): void {
  // Prefer evicting an idle channel (refCount === 0) first.
  let evictKey: string | null = null;
  let oldestIdle = Infinity;
  let oldestActive: string | null = null;
  let oldestActiveTime = Infinity;

  for (const [key, entry] of pool.entries()) {
    if (entry.refCount === 0 && entry.createdAt < oldestIdle) {
      oldestIdle = entry.createdAt;
      evictKey = key;
    }
    if (entry.createdAt < oldestActiveTime) {
      oldestActiveTime = entry.createdAt;
      oldestActive = key;
    }
  }

  const target = evictKey ?? oldestActive;
  if (!target) return;

  const entry = pool.get(target)!;
  if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);

  // Notify active subscribers so they can react (re-subscribe, show UI indicator).
  // Only fired when the evicted channel still has active listeners (refCount > 0).
  if (entry.refCount > 0) {
    console.warn(
      `[realtimeChannelPool] evicting active channel "${target}" (refCount=${entry.refCount}) — subscribers should re-subscribe`,
    );
    const evictedPayload: ChannelEvictedPayload = { type: 'CHANNEL_EVICTED', key: target };
    for (const cb of entry.callbacks) {
      try {
        cb(evictedPayload);
      } catch {
        /* subscriber errors must not break eviction */
      }
    }
  }

  supabase.removeChannel(entry.channel);
  pool.delete(target);
}

/**
 * Subscribe to a Supabase Realtime event via the shared channel pool.
 *
 * @param key       Unique channel identifier, e.g. "conversation-<uuid>".
 *                  Callers with the same key share one WebSocket channel.
 * @param setup     Called ONLY when a NEW channel is created (not on reuse).
 *                  Receives `(channel, dispatch)` — attach `.on(...)` using
 *                  `dispatch` as the handler. Must call `.subscribe()` and
 *                  return the channel.
 * @param callback  Handler invoked for every incoming event on this key.
 * @returns         Cleanup function — call it when the subscriber unmounts.
 */
export function pooledSubscribe(
  key: string,
  setup: (channel: RealtimeChannel, dispatch: DispatchFn) => RealtimeChannel,
  callback: DispatchFn,
): () => void {
  let entry = pool.get(key);

  if (!entry) {
    if (pool.size >= MAX_CHANNELS) evictOne();

    const callbacks = new Set<DispatchFn>();
    // dispatch is the single handler passed to supabase .on() —
    // it fans out to all currently registered callbacks.
    const dispatch: DispatchFn = (payload) => {
      for (const cb of callbacks) cb(payload);
    };
    const channel = setup(supabase.channel(key), dispatch);
    entry = { channel, callbacks, refCount: 0, idleTimer: null, createdAt: Date.now() };
    pool.set(key, entry);
  } else if (entry.idleTimer !== null) {
    // Channel was idle (waiting to be evicted) — cancel eviction, reuse it.
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  entry.callbacks.add(callback);
  entry.refCount++;

  // Guard against double-invocation (React Strict Mode, accidental double-unmount).
  let cleaned = false;

  return () => {
    if (cleaned) return;
    cleaned = true;

    const e = pool.get(key);
    if (!e) return;
    e.callbacks.delete(callback);
    e.refCount = Math.max(0, e.refCount - 1);

    if (e.refCount === 0) {
      // Clear any existing idle timer before setting a new one to prevent
      // multiple concurrent timers for the same channel.
      if (e.idleTimer !== null) clearTimeout(e.idleTimer);
      // Keep channel open briefly — user might navigate back.
      e.idleTimer = setTimeout(() => {
        supabase.removeChannel(e.channel);
        pool.delete(key);
      }, IDLE_EVICT_MS);
    }
  };
}

// ---------------------------------------------------------------------------
// Diagnostics (for debugging / monitoring)
// ---------------------------------------------------------------------------

/** Returns current pool stats. Useful for logging or dev tools. */
export function getChannelPoolStats(): { total: number; active: number; idle: number } {
  let active = 0;
  let idle = 0;
  for (const entry of pool.values()) {
    if (entry.refCount > 0) active++;
    else idle++;
  }
  return { total: pool.size, active, idle };
}

/** Immediately close all idle channels. Call on app backgrounding. */
export function flushIdleChannels(): void {
  for (const [key, entry] of pool.entries()) {
    if (entry.refCount === 0) {
      if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
      supabase.removeChannel(entry.channel);
      pool.delete(key);
    }
  }
}

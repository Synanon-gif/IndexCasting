/**
 * Client-side in-memory rate limiter with burst detection and cooldown.
 * Prevents chat message spam and upload floods.
 *
 * Layers of protection:
 * 1. Sliding-window limit (e.g. 30 messages/min)
 * 2. Burst detection: if N actions within a short window → hard cooldown
 * 3. Per-user and per-org buckets
 *
 * Note: This is a first-line defense at the UI layer.
 * Backend rate limiting (Supabase Edge Functions) should be added for
 * production-grade server-side enforcement.
 */

export interface RateLimiterOptions {
  /** Maximum number of actions allowed within the sliding window. */
  maxCount: number;
  /** Sliding window duration in milliseconds. */
  windowMs: number;
  /**
   * Burst detection: max actions allowed within burstWindowMs before
   * triggering a hard cooldown.
   */
  burstCount?: number;
  /** Burst detection window in milliseconds. Default: 3000ms. */
  burstWindowMs?: number;
  /** Hard cooldown duration after burst is detected. Default: 30s. */
  cooldownMs?: number;
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; error: string; retryAfterMs: number; isCooldown?: boolean };

/**
 * Sliding-window in-memory rate limiter with optional burst detection.
 * Keyed by an arbitrary string (userId, orgId, conversationId, etc.).
 */
export class RateLimiter {
  private readonly maxCount: number;
  private readonly windowMs: number;
  private readonly burstCount: number;
  private readonly burstWindowMs: number;
  private readonly cooldownMs: number;

  /** Map of key → sorted list of action timestamps (oldest first). */
  private readonly buckets = new Map<string, number[]>();
  /** Map of key → cooldown expiry timestamp (Date.now() + cooldownMs). */
  private readonly cooldowns = new Map<string, number>();

  constructor(opts: RateLimiterOptions) {
    this.maxCount = opts.maxCount;
    this.windowMs = opts.windowMs;
    this.burstCount = opts.burstCount ?? 5;
    this.burstWindowMs = opts.burstWindowMs ?? 3000;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
  }

  /**
   * Records an action for the given key and returns whether it is allowed.
   * Call this BEFORE performing the action.
   * @param key – typically a userId, orgId, or conversationId
   */
  check(key: string): RateLimitResult {
    const now = Date.now();

    // 1. Check active cooldown (set by burst detection)
    const cooldownUntil = this.cooldowns.get(key);
    if (cooldownUntil !== undefined && now < cooldownUntil) {
      const retryAfterMs = cooldownUntil - now;
      return {
        ok: false,
        isCooldown: true,
        error: `You are sending too fast. Please wait ${Math.ceil(retryAfterMs / 1000)} second(s).`,
        retryAfterMs,
      };
    } else if (cooldownUntil !== undefined && now >= cooldownUntil) {
      this.cooldowns.delete(key);
    }

    // 2. Evict timestamps outside the sliding window
    const windowStart = now - this.windowMs;
    const timestamps = (this.buckets.get(key) ?? []).filter((t) => t > windowStart);

    // 3. Check sliding-window limit
    if (timestamps.length >= this.maxCount) {
      const oldest = timestamps[0];
      const retryAfterMs = oldest + this.windowMs - now;
      return {
        ok: false,
        error: `Too many actions. Please wait ${Math.ceil(retryAfterMs / 1000)} second(s) before trying again.`,
        retryAfterMs,
      };
    }

    // 4. Burst detection: count actions within the burst window
    const burstWindowStart = now - this.burstWindowMs;
    const burstCount = timestamps.filter((t) => t > burstWindowStart).length;
    if (burstCount >= this.burstCount) {
      // Apply hard cooldown
      this.cooldowns.set(key, now + this.cooldownMs);
      return {
        ok: false,
        isCooldown: true,
        error: `Burst detected. Please wait ${Math.ceil(this.cooldownMs / 1000)} second(s).`,
        retryAfterMs: this.cooldownMs,
      };
    }

    // 5. Allow: record timestamp
    timestamps.push(now);
    this.buckets.set(key, timestamps);
    return { ok: true };
  }

  /**
   * Returns the number of remaining allowed actions for a key within the current window.
   */
  remaining(key: string): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.buckets.get(key) ?? []).filter((t) => t > windowStart);
    return Math.max(0, this.maxCount - timestamps.length);
  }

  /** Returns true if the key is currently in hard cooldown. */
  isInCooldown(key: string): boolean {
    const now = Date.now();
    const cooldownUntil = this.cooldowns.get(key);
    return cooldownUntil !== undefined && now < cooldownUntil;
  }

  /** Clears all recorded actions and cooldowns for a key. Useful for testing. */
  reset(key: string): void {
    this.buckets.delete(key);
    this.cooldowns.delete(key);
  }

  /** Clears all buckets and cooldowns. */
  resetAll(): void {
    this.buckets.clear();
    this.cooldowns.clear();
  }
}

/**
 * Shared rate limiter for chat messages (per-user/conversation).
 * Allows 30 messages/min with burst detection: >5 in 3s → 30s cooldown.
 */
export const messageLimiter = new RateLimiter({
  maxCount: 30,
  windowMs: 60 * 1000,
  burstCount: 5,
  burstWindowMs: 3000,
  cooldownMs: 30_000,
});

/**
 * Shared rate limiter for file uploads (per-user).
 * Allows 10 uploads/min with burst detection: >3 in 5s → 30s cooldown.
 */
export const uploadLimiter = new RateLimiter({
  maxCount: 10,
  windowMs: 60 * 1000,
  burstCount: 3,
  burstWindowMs: 5000,
  cooldownMs: 30_000,
});

/**
 * Shared rate limiter for org-wide message sending.
 * Prevents a single organization from flooding the system.
 * Allows 20 messages/min per org.
 */
export const orgMessageLimiter = new RateLimiter({
  maxCount: 20,
  windowMs: 60 * 1000,
  burstCount: 8,
  burstWindowMs: 5000,
  cooldownMs: 60_000,
});

/**
 * Shared assertions for AI assistant answers and minimized fact payloads.
 * Used by exhaustive matrix + smoke tests to keep security checks consistent.
 */

import { expect } from '@jest/globals';

/** UUID v4 shape */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** Loose email detection */
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

const PHONE_RE = /\+\d[\d\s().-]{6,}\d/;

const URL_RE = /https?:\/\/[^\s"'<>]+/i;

/** Common internal naming leaks */
const SQL_RPC_RE =
  /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\b(?:public\.)?[a-z_]{3,}\s*\(|option_requests|service_role|ROW LEVEL SECURITY|\bRLS\b|\bmigration\b/i;

const WRITE_DONE_RE =
  /\b(?:I\s+(?:have|ve|had)\s+(?:created|updated|deleted|confirmed|cancelled|canceled|sent|booked|invited))\b|\b(?:successfully\s+(?:created|updated|deleted|booked))\b/i;

export type AssertAiResponseSafeOptions = {
  /** When true, allow email-like substrings (default: reject) */
  allowEmail?: boolean;
};

/**
 * Asserts stringified assistant-facing content does not contain common leak classes.
 */
export function assertAiResponseSafe(
  value: unknown,
  options: AssertAiResponseSafeOptions = {},
): void {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  expect(s).not.toMatch(UUID_RE);
  if (!options.allowEmail) {
    expect(s).not.toMatch(EMAIL_RE);
  }
  expect(s).not.toMatch(PHONE_RE);
  expect(s).not.toMatch(URL_RE);
  expect(s).not.toMatch(SQL_RPC_RE);
  expect(s).not.toMatch(/service[\s_-]?role/i);
}

/**
 * Forbidden-route answers must never claim writes were performed.
 */
export function assertForbiddenAnswerNoWriteClaim(intent: string, answer: string): void {
  expect(answer).not.toMatch(WRITE_DONE_RE);
  expect(answer.toLowerCase()).not.toContain('service_role');
}

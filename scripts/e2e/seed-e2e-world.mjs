#!/usr/bin/env node
/**
 * E2E world seed — IndexCasting
 *
 * Creates isolated PLAYWRIGHT / E2E TEST–marked data via:
 * - auth.admin.createUser (email_confirm: true — no inbox required)
 * - User session + ensure_plain_signup_b2b_owner_bootstrap for B2B orgs
 * - Service role inserts for members, models, projects, chats, etc.
 *
 * SAFETY:
 * - Refuses to run unless E2E_ALLOW_SEED_ON_THIS_DATABASE=I_UNDERSTAND
 * - Does not DELETE or UPDATE unrelated rows; uses idempotent upserts where possible
 * - Intended ONLY for dedicated staging / branch databases
 *
 * NO application code, RLS, schema, or auth logic changes — operational script only.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const requireCjs = createRequire(import.meta.url);
const { assertSeedScriptSafe } = requireCjs('./e2eSafetyGuard.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

config({ path: path.join(ROOT, '.env.e2e') });
config({ path: path.join(ROOT, '.env.local') });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PASS = process.env.E2E_SEED_USER_PASSWORD || '';
const SAFETY = process.env.E2E_ALLOW_SEED_ON_THIS_DATABASE || '';

/** Deterministic placeholder — no real photos; HTTPS placeholder service only. */
function placeholderPortfolioUrls(seed) {
  const base = `https://placehold.co`;
  const ac = encodeURIComponent(`E2E TEST portrait ${seed}`);
  return [
    `${base}/800x1200/2C3E50/ECF0F1/png?text=${ac}`,
    `${base}/800x1000/34495E/BDC3C7/png?text=${encodeURIComponent(`E2E editorial ${seed}`)}`,
  ];
}

function placeholderPolaroidUrls(seed) {
  const base = `https://placehold.co`;
  return [
    `${base}/600x800/7F8C8D/FFFFFF/png?text=${encodeURIComponent(`E2E digital ${seed}`)}`,
  ];
}

/**
 * Deterministic model UUIDs (hex-only). Pattern is arbitrary but stable across re-seeds.
 * Range n=1..35 and n=36 (unlinked stub) fit in 12 hex digits.
 */
function modelUuid(n) {
  return `aaaaaaaa-0000-4e2e-8000-${n.toString(16).padStart(12, '0')}`;
}

/** Must match `src/utils/b2bOrgPairContextId.ts` for B2B chat dedupe. */
function b2bOrgPairContextId(clientOrgId, agencyOrgId) {
  const [a, b] = [clientOrgId, agencyOrgId].sort((x, y) => x.localeCompare(y));
  return `b2b:${a}:${b}`;
}

function die(msg) {
  console.error(`[e2e-seed] FATAL: ${msg}`);
  process.exit(1);
}

if (SAFETY !== 'I_UNDERSTAND') {
  die(
    'Set E2E_ALLOW_SEED_ON_THIS_DATABASE=I_UNDERSTAND in .env.e2e (isolated DB only).',
  );
}
if (!SUPABASE_URL || !ANON || !SERVICE) {
  die('Missing EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.');
}
if (!PASS || PASS.length < 16) {
  die('E2E_SEED_USER_PASSWORD must be set and at least 16 characters.');
}

assertSeedScriptSafe(
  SUPABASE_URL,
  process.env.E2E_BASE_URL?.trim() || process.env.PLAYWRIGHT_BASE_URL?.trim() || '',
  process.env,
);

/** Stable list copy for Playwright — keep in sync with `tests/e2e/p0-option-casting.spec.ts`. */
const E2E_OPTION_JOB_LINKED = 'E2E TEST — Linked option workflow';
const E2E_OPTION_JOB_CASTING = 'E2E TEST — Casting workflow';
const E2E_OPTION_JOB_UNLINKED = 'E2E TEST — Unlinked option workflow';
/** Legacy seed labels (idempotent re-seed: match existing rows before inserting duplicates). */
const LEGACY_OPTION_DESC_LINKED = 'PLAYWRIGHT — option test; availability + fee axes.';
const LEGACY_OPTION_DESC_CASTING = 'PLAYWRIGHT — casting test; schedule + negotiation UI.';
const LEGACY_OPTION_DESC_UNLINKED = 'PLAYWRIGHT — unlinked model option; no app account path.';

async function findOptionRequestIdByJobDescriptions(client, descriptions, clientOrgId) {
  for (const job_description of descriptions) {
    let q = client.from('option_requests').select('id').eq('job_description', job_description);
    if (clientOrgId) q = q.eq('client_organization_id', clientOrgId);
    const { data: rows, error } = await q.limit(1);
    if (error) {
      console.warn('[e2e-seed] option_requests lookup:', error.message);
      continue;
    }
    const id = rows?.[0]?.id;
    if (id) return id;
  }
  return null;
}

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ACCOUNTS = {
  agencyOwner: {
    email: 'e2e-agency-owner@index-casting.test',
    role: 'agent',
    company: 'E2E TEST — Northwind Models (Large Agency)',
    display: 'E2E Agency Owner',
  },
  booker: {
    email: 'e2e-booker@index-casting.test',
    role: 'agent',
    company: 'E2E TEST — Northwind Models (Large Agency)',
    display: 'E2E Booker',
  },
  agencyBoutique: {
    email: 'e2e-agency-boutique@index-casting.test',
    role: 'agent',
    company: 'E2E TEST — Atelier Volt (Boutique)',
    display: 'E2E Boutique Owner',
  },
  agencySolo: {
    email: 'e2e-agency-solo@index-casting.test',
    role: 'agent',
    company: 'E2E TEST — Solo Scout Co',
    display: 'E2E Solo Agent',
  },
  clientOwner: {
    email: 'e2e-client-owner@index-casting.test',
    role: 'client',
    company: 'E2E TEST — Maison Horizon Fashion',
    display: 'E2E Client Owner',
  },
  clientTeam: {
    email: 'e2e-client-team@index-casting.test',
    role: 'client',
    company: 'E2E TEST — Maison Horizon Fashion',
    display: 'E2E Client Employee',
  },
  modelLinked: {
    email: 'e2e-model-linked@index-casting.test',
    role: 'model',
    company: '',
    display: 'E2E Linked Model',
  },
  modelUnlinked: {
    email: 'e2e-model-unlinked@index-casting.test',
    role: 'model',
    company: '',
    display: 'E2E Unlinked Model Persona',
  },
  applicant: {
    email: 'e2e-applicant@index-casting.test',
    role: 'model',
    company: '',
    display: 'E2E Applicant',
  },
};

async function ensureAuthUser({ email, password, user_metadata }) {
  const { data: existingPage, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) die(`listUsers: ${listErr.message}`);
  const found = existingPage?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (found) {
    await admin.auth.admin.updateUserById(found.id, {
      password,
      email_confirm: true,
      user_metadata: { ...found.user_metadata, ...user_metadata },
    });
    return found.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata,
  });
  if (error) die(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function withUserClient(email, password, fn) {
  const client = createClient(SUPABASE_URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) die(`signIn ${email}: ${error.message}`);
  try {
    return await fn(client, data.user);
  } finally {
    await client.auth.signOut();
  }
}

async function runBootstrapB2b(email, password) {
  return withUserClient(email, password, async (client) => {
    const { data, error } = await client.rpc('ensure_plain_signup_b2b_owner_bootstrap');
    if (error) return { ok: false, err: error.message, raw: null };
    return { ok: true, err: null, raw: data };
  });
}

async function fetchMembershipOrgIds(userId) {
  const { data, error } = await admin
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', userId);
  if (error) die(`organization_members: ${error.message}`);
  return data ?? [];
}

async function fetchOrgWithAgency(orgId) {
  const { data, error } = await admin.from('organizations').select('id, type, agency_id').eq('id', orgId).maybeSingle();
  if (error) die(`organizations ${orgId}: ${error.message}`);
  return data;
}

async function upsertAgencyBranding(agencyId, patch) {
  const { error } = await admin.from('agencies').update(patch).eq('id', agencyId);
  if (error) console.warn('[e2e-seed] agencies branding update (non-fatal):', error.message);
}

async function ensureBookerMembership(bookerUserId, orgId) {
  const { error } = await admin.from('organization_members').upsert(
    {
      organization_id: orgId,
      user_id: bookerUserId,
      role: 'booker',
    },
    { onConflict: 'organization_id,user_id' },
  );
  if (error) die(`booker membership: ${error.message}`);
}

async function ensureEmployeeMembership(employeeUserId, orgId) {
  const { error } = await admin.from('organization_members').upsert(
    {
      organization_id: orgId,
      user_id: employeeUserId,
      role: 'employee',
    },
    { onConflict: 'organization_id,user_id' },
  );
  if (error) die(`employee membership: ${error.message}`);
}

async function main() {
  console.log('[e2e-seed] Starting (isolated DB check: operator must have confirmed I_UNDERSTAND).');

  const ids = {};
  for (const [key, acc] of Object.entries(ACCOUNTS)) {
    ids[key] = await ensureAuthUser({
      email: acc.email,
      password: PASS,
      user_metadata: {
        role: acc.role,
        display_name: acc.display,
        ...(acc.company ? { company_name: acc.company } : {}),
      },
    });
    console.log(`[e2e-seed] User OK: ${acc.email} → ${ids[key].slice(0, 8)}…`);
  }

  // B2B bootstraps (real product RPCs — session as user)
  for (const email of [
    ACCOUNTS.agencyOwner.email,
    ACCOUNTS.agencyBoutique.email,
    ACCOUNTS.agencySolo.email,
    ACCOUNTS.clientOwner.email,
  ]) {
    const r = await runBootstrapB2b(email, PASS);
    if (!r.ok) die(`bootstrap ${email}: ${r.err}`);
    console.log(`[e2e-seed] Bootstrap OK: ${email}`, r.raw);
  }

  const agencyOwnerRows = await fetchMembershipOrgIds(ids.agencyOwner);
  const primaryAgencyOrgId = agencyOwnerRows[0]?.organization_id;
  if (!primaryAgencyOrgId) die('Primary agency org not found after bootstrap.');
  const primaryOrg = await fetchOrgWithAgency(primaryAgencyOrgId);
  const primaryAgencyId = primaryOrg?.agency_id;
  if (!primaryAgencyId) die('Primary agency_id missing on organization row.');

  await ensureBookerMembership(ids.booker, primaryAgencyOrgId);
  console.log('[e2e-seed] Booker linked to primary agency org.');

  const clientOwnerRows = await fetchMembershipOrgIds(ids.clientOwner);
  const primaryClientOrgId = clientOwnerRows[0]?.organization_id;
  if (!primaryClientOrgId) die('Client org not found.');
  await ensureEmployeeMembership(ids.clientTeam, primaryClientOrgId);
  console.log('[e2e-seed] Client employee linked.');

  // --- Public org profiles (safe synthetic copy only) ---
  const orgProfileSeeds = [
    {
      organization_id: primaryAgencyOrgId,
      slug: 'playwright-e2e-northwind',
      description:
        'E2E TEST — Synthetic public agency profile for Playwright. Not a real business.',
      website_url: 'https://e2e-test.invalid/northwind',
      logo_url: 'https://placehold.co/256x256/1a1a1a/ffffff/png?text=E2E+Agency',
      contact_email: 'e2e-public-agency@index-casting.test',
      contact_phone: '+1-555-0199-E2E',
      city: 'Berlin',
      country: 'DE',
      address_line_1: 'E2E TEST — Sample Street 1',
      postal_code: '10115',
      is_public: true,
    },
    {
      organization_id: primaryClientOrgId,
      slug: 'playwright-e2e-horizon',
      description:
        'E2E TEST — Synthetic public client profile for Playwright. Not a real brand.',
      website_url: 'https://e2e-test.invalid/horizon',
      logo_url: 'https://placehold.co/256x256/2c3e50/ecf0f1/png?text=E2E+Client',
      contact_email: 'e2e-public-client@index-casting.test',
      contact_phone: '+1-555-0198-E2E',
      city: 'Amsterdam',
      country: 'NL',
      address_line_1: 'E2E TEST — Canal House 9',
      postal_code: '1012',
      is_public: true,
    },
  ];
  for (const row of orgProfileSeeds) {
    const { error: opErr } = await admin.from('organization_profiles').upsert(row, {
      onConflict: 'organization_id',
    });
    if (opErr) console.warn('[e2e-seed] organization_profiles:', opErr.message);
  }
  await upsertAgencyBranding(primaryAgencyId, {
    name: 'E2E TEST — Northwind Models',
    city: 'Berlin',
    focus: 'fashion · commercial · editorial',
    email: ACCOUNTS.agencyOwner.email,
    website: 'https://e2e-test.invalid/northwind',
    phone: '+1-555-0100-E2E',
    description:
      'PLAYWRIGHT — Synthetic large agency profile for calendar, discovery, and package tests.',
  });

  const boutiqueOrg = await fetchOrgWithAgency((await fetchMembershipOrgIds(ids.agencyBoutique))[0].organization_id);
  const soloOrg = await fetchOrgWithAgency((await fetchMembershipOrgIds(ids.agencySolo))[0].organization_id);
  if (boutiqueOrg?.agency_id) {
    await upsertAgencyBranding(boutiqueOrg.agency_id, {
      name: 'E2E TEST — Atelier Volt',
      city: 'Paris',
      focus: 'luxury · editorial',
      email: ACCOUNTS.agencyBoutique.email,
      website: 'https://e2e-test.invalid/atelier-volt',
    });
  }
  if (soloOrg?.agency_id) {
    await upsertAgencyBranding(soloOrg.agency_id, {
      name: 'E2E TEST — Solo Scout Co',
      city: 'Milan',
      focus: 'lifestyle · showroom',
      email: ACCOUNTS.agencySolo.email,
      website: 'https://e2e-test.invalid/solo-scout',
    });
  }

  // --- Models (35) — primary agency + split across boutique/solo for territory variety ---
  const genders = ['female', 'male'];
  const cities = [
    ['Berlin', 'DE'],
    ['Paris', 'FR'],
    ['Milan', 'IT'],
    ['Amsterdam', 'NL'],
    ['London', 'GB'],
    ['Barcelona', 'ES'],
  ];
  const modelRows = [];
  for (let i = 1; i <= 35; i += 1) {
    const id = modelUuid(i);
    let agency_id = primaryAgencyId;
    if (i % 7 === 0 && boutiqueOrg?.agency_id) agency_id = boutiqueOrg.agency_id;
    if (i % 11 === 0 && soloOrg?.agency_id) agency_id = soloOrg.agency_id;

    const [city, cc] = cities[i % cities.length];
    const sex = genders[i % genders.length];
    const height = 170 + (i % 18);
    const bust = 78 + (i % 12);
    const name = `E2E TEST — Model ${String(i).padStart(2, '0')}`;

    modelRows.push({
      id,
      agency_id,
      name,
      height,
      bust,
      chest: bust,
      waist: 58 + (i % 10),
      hips: 86 + (i % 12),
      city,
      country_code: cc,
      hair_color: ['Dark Brown', 'Black', 'Blonde', 'Auburn'][i % 4],
      eye_color: ['Brown', 'Green', 'Blue', 'Hazel'][i % 4],
      sex,
      portfolio_images: placeholderPortfolioUrls(i),
      polaroids: placeholderPolaroidUrls(i),
      is_visible_fashion: i % 9 !== 0,
      is_visible_commercial: i % 11 !== 0,
      agency_relationship_status: i % 15 === 0 ? 'pending_link' : 'active',
      current_location: city,
      mediaslide_sync_id: null,
    });
  }

  const { error: modelsErr } = await admin.from('models').upsert(modelRows, { onConflict: 'id' });
  if (modelsErr) die(`models upsert: ${modelsErr.message}`);

  // model_agency_territories — DE + FR + IT for discovery
  const matRows = [];
  for (const m of modelRows) {
    for (const cc of ['DE', 'FR']) {
      matRows.push({
        model_id: m.id,
        agency_id: m.agency_id,
        country_code: cc,
      });
    }
    if (m.country_code === 'IT' || m.country_code === 'ES' || m.country_code === 'NL') {
      matRows.push({
        model_id: m.id,
        agency_id: m.agency_id,
        country_code: m.country_code,
      });
    }
  }
  const { error: matErr } = await admin.from('model_agency_territories').upsert(matRows, {
    onConflict: 'model_id,country_code',
  });
  if (matErr) console.warn('[e2e-seed] MAT upsert (non-fatal):', matErr.message);

  // Agency-sourced location rows (canonical city display)
  const locRows = modelRows.map((m) => ({
    model_id: m.id,
    source: 'agency',
    city: m.city,
    country_code: m.country_code,
    share_approximate_location: false,
  }));
  const { error: locErr } = await admin.from('model_locations').upsert(locRows, {
    onConflict: 'model_id,source',
  });
  if (locErr) console.warn('[e2e-seed] model_locations (non-fatal):', locErr.message);

  // Link one model to e2e-model-linked user
  const linkedModelId = modelRows[0].id;
  const { error: linkErr } = await admin
    .from('models')
    .update({ user_id: ids.modelLinked, email: 'e2e-model-linked@index-casting.test' })
    .eq('id', linkedModelId);
  if (linkErr) console.warn('[e2e-seed] link model user (non-fatal):', linkErr.message);

  // Standalone unlinked model row for "unlinked" persona (minimal)
  const unlinkedId = modelUuid(36);
  const { error: uErr } = await admin.from('models').upsert(
    {
      id: unlinkedId,
      agency_id: primaryAgencyId,
      name: 'E2E TEST — Unlinked roster stub',
      height: 176,
      bust: 82,
      chest: 82,
      waist: 62,
      hips: 90,
      city: 'Hamburg',
      country_code: 'DE',
      portfolio_images: placeholderPortfolioUrls(999),
      polaroids: [],
      is_visible_fashion: true,
      is_visible_commercial: true,
      agency_relationship_status: 'active',
    },
    { onConflict: 'id' },
  );
  if (uErr) console.warn('[e2e-seed] unlinked stub (non-fatal):', uErr.message);

  /** Unlinked model has territories + location so clients can open seeded option threads. */
  let unlinkedSeedReady = !uErr;
  if (unlinkedSeedReady) {
    const { error: matU } = await admin.from('model_agency_territories').upsert(
      [
        { model_id: unlinkedId, agency_id: primaryAgencyId, country_code: 'DE' },
        { model_id: unlinkedId, agency_id: primaryAgencyId, country_code: 'FR' },
      ],
      { onConflict: 'model_id,country_code' },
    );
    if (matU) {
      console.warn('[e2e-seed] MAT unlinked:', matU.message);
      unlinkedSeedReady = false;
    }
    const { error: locUErr } = await admin.from('model_locations').upsert(
      {
        model_id: unlinkedId,
        source: 'agency',
        city: 'Hamburg',
        country_code: 'DE',
        share_approximate_location: false,
      },
      { onConflict: 'model_id,source' },
    );
    if (locUErr) console.warn('[e2e-seed] model_locations unlinked:', locUErr.message);
  }

  // --- Client projects ---
  const projects = [
    { name: 'E2E TEST — Editorial SS campaign', kind: 'editorial' },
    { name: 'E2E TEST — E-commerce lookbook', kind: 'ecom' },
    { name: 'E2E TEST — Runway casting week', kind: 'runway' },
    { name: 'E2E TEST — Beauty close-ups', kind: 'beauty' },
    { name: 'E2E TEST — Showroom fitting', kind: 'showroom' },
    { name: 'E2E TEST — Social content wave', kind: 'social' },
  ];
  const projectIds = [];
  for (const p of projects) {
    const { data: existing } = await admin
      .from('client_projects')
      .select('id')
      .eq('owner_id', ids.clientOwner)
      .eq('organization_id', primaryClientOrgId)
      .eq('name', p.name)
      .maybeSingle();
    if (existing?.id) {
      projectIds.push(existing.id);
      continue;
    }
    const { data, error } = await admin
      .from('client_projects')
      .insert({
        owner_id: ids.clientOwner,
        organization_id: primaryClientOrgId,
        name: p.name,
      })
      .select('id')
      .single();
    if (error) console.warn('[e2e-seed] client_projects:', p.name, error.message);
    else if (data?.id) projectIds.push(data.id);
  }

  // Assign models to first project
  if (projectIds[0]) {
    const picks = modelRows.slice(0, 12).map((m) => ({
      project_id: projectIds[0],
      model_id: m.id,
    }));
    const { error: cpmErr } = await admin.from('client_project_models').upsert(picks, {
      onConflict: 'project_id,model_id',
    });
    if (cpmErr) console.warn('[e2e-seed] client_project_models:', cpmErr.message);
  }

  // --- Option requests (service role — same shape as product insert defaults) ---
  const sampleModel = modelRows[4];
  const inThreeDays = new Date();
  inThreeDays.setDate(inThreeDays.getDate() + 3);
  const reqDate = inThreeDays.toISOString().slice(0, 10);

  const optPayload = {
    client_id: ids.clientOwner,
    model_id: sampleModel.id,
    agency_id: primaryAgencyId,
    requested_date: reqDate,
    request_type: 'option',
    project_id: projectIds[0] ?? null,
    client_name: 'E2E TEST — Horizon lead',
    model_name: sampleModel.name,
    job_description: E2E_OPTION_JOB_LINKED,
    proposed_price: 2500,
    currency: 'EUR',
    start_time: '10:00',
    end_time: '18:00',
    organization_id: primaryClientOrgId,
    agency_organization_id: primaryAgencyOrgId,
    client_organization_id: primaryClientOrgId,
    client_organization_name: 'E2E TEST — Maison Horizon Fashion',
    created_by: ids.clientOwner,
    model_account_linked: true,
  };

  let optReqId = await findOptionRequestIdByJobDescriptions(admin, [E2E_OPTION_JOB_LINKED, LEGACY_OPTION_DESC_LINKED], primaryClientOrgId);
  let optInserted = false;
  if (!optReqId) {
    const { data: optReq, error: optErr } = await admin.from('option_requests').insert(optPayload).select('id').single();
    if (optErr) console.warn('[e2e-seed] option_requests:', optErr.message);
    else {
      optReqId = optReq?.id ?? null;
      optInserted = !!optReqId;
      if (optReqId) console.log('[e2e-seed] option_request insert', optReqId);
    }
  } else {
    console.log('[e2e-seed] option_request reuse', optReqId);
  }

  if (optReqId && optInserted) {
    const threadSeeds = [
      {
        from_role: 'client',
        text: 'E2E TEST — We would like to confirm the model for the proposed date. Budget discussed internally.',
      },
      {
        from_role: 'agency',
        text: 'E2E TEST — Availability looks good on our side. Sharing board link separately.',
      },
    ];
    for (const m of threadSeeds) {
      const { error: omErr } = await admin.from('option_request_messages').insert({
        option_request_id: optReqId,
        from_role: m.from_role,
        text: m.text,
      });
      if (omErr) console.warn('[e2e-seed] option_request_messages:', omErr.message);
    }
  }

  const castPayload = {
    client_id: optPayload.client_id,
    model_id: modelRows[5].id,
    agency_id: optPayload.agency_id,
    requested_date: reqDate,
    request_type: 'casting',
    project_id: optPayload.project_id,
    client_name: optPayload.client_name,
    model_name: modelRows[5].name,
    job_description: E2E_OPTION_JOB_CASTING,
    proposed_price: 1800,
    currency: 'EUR',
    start_time: '11:00',
    end_time: '17:00',
    organization_id: primaryClientOrgId,
    agency_organization_id: primaryAgencyOrgId,
    client_organization_id: primaryClientOrgId,
    client_organization_name: optPayload.client_organization_name,
    created_by: ids.clientOwner,
    model_account_linked: true,
  };
  let castingOptionRequestId = await findOptionRequestIdByJobDescriptions(
    admin,
    [E2E_OPTION_JOB_CASTING, LEGACY_OPTION_DESC_CASTING],
    primaryClientOrgId,
  );
  if (!castingOptionRequestId) {
    const { data: castReq, error: castErr } = await admin
      .from('option_requests')
      .insert(castPayload)
      .select('id')
      .single();
    if (castErr) console.warn('[e2e-seed] casting option_requests:', castErr.message);
    else castingOptionRequestId = castReq?.id ?? null;
  } else {
    console.log('[e2e-seed] casting option_request reuse', castingOptionRequestId);
  }

  let unlinkedOptionRequestId = null;
  if (unlinkedSeedReady) {
    const unlinkedOptPayload = {
      client_id: ids.clientOwner,
      model_id: unlinkedId,
      agency_id: primaryAgencyId,
      requested_date: reqDate,
      request_type: 'option',
      project_id: projectIds[0] ?? null,
      client_name: 'E2E TEST — Horizon lead',
      model_name: 'E2E TEST — Unlinked roster stub',
      job_description: E2E_OPTION_JOB_UNLINKED,
      proposed_price: 1900,
      currency: 'EUR',
      start_time: '12:00',
      end_time: '16:00',
      organization_id: primaryClientOrgId,
      agency_organization_id: primaryAgencyOrgId,
      client_organization_id: primaryClientOrgId,
      client_organization_name: 'E2E TEST — Maison Horizon Fashion',
      created_by: ids.clientOwner,
      model_account_linked: false,
    };
    unlinkedOptionRequestId = await findOptionRequestIdByJobDescriptions(
      admin,
      [E2E_OPTION_JOB_UNLINKED, LEGACY_OPTION_DESC_UNLINKED],
      primaryClientOrgId,
    );
    if (!unlinkedOptionRequestId) {
      const { data: uo, error: uoErr } = await admin
        .from('option_requests')
        .insert(unlinkedOptPayload)
        .select('id')
        .single();
      if (uoErr) console.warn('[e2e-seed] unlinked option_requests:', uoErr.message);
      else unlinkedOptionRequestId = uo?.id ?? null;
    } else {
      console.log('[e2e-seed] unlinked option_request reuse', unlinkedOptionRequestId);
    }
  }

  // --- Calendar stress rows (model calendar — personal + tentative booking) ---
  const d1 = new Date();
  const d2 = new Date(d1);
  d2.setDate(d2.getDate() + 2);
  const dPast = new Date(d1);
  dPast.setDate(dPast.getDate() - 4);

  for (const [label, dateStr, title] of [
    ['past', dPast.toISOString().slice(0, 10), 'E2E TEST — past fitting'],
    ['futureA', d1.toISOString().slice(0, 10), 'E2E TEST — showroom block'],
    ['futureB', d2.toISOString().slice(0, 10), 'E2E TEST — overlap A'],
    ['futureC', d2.toISOString().slice(0, 10), 'E2E TEST — overlap B'],
  ]) {
    const { error: ceErr } = await admin.from('calendar_entries').insert({
      model_id: linkedModelId,
      date: dateStr,
      title,
      entry_type: label.startsWith('past') ? 'booking' : 'personal',
      status: 'tentative',
      start_time: '09:00',
      end_time: '12:00',
      note: `PLAYWRIGHT — ${label}`,
    });
    if (ceErr) console.warn('[e2e-seed] calendar_entries:', label, ceErr.message);
  }

  // --- B2B conversation + messages ---
  const ctx = b2bOrgPairContextId(primaryClientOrgId, primaryAgencyOrgId);
  let convId = null;
  const { data: convInsert, error: convErr } = await admin
    .from('conversations')
    .insert({
      type: 'direct',
      context_id: ctx,
      title: 'E2E TEST — Horizon ↔ Northwind',
      client_organization_id: primaryClientOrgId,
      agency_organization_id: primaryAgencyOrgId,
      participant_ids: [ids.clientOwner, ids.agencyOwner, ids.booker].filter(Boolean),
    })
    .select('id')
    .single();
  if (convErr) {
    const { data: existing } = await admin
      .from('conversations')
      .select('id')
      .eq('context_id', ctx)
      .maybeSingle();
    convId = existing?.id ?? null;
    if (!convId) console.warn('[e2e-seed] conversations:', convErr.message);
  } else {
    convId = convInsert?.id;
  }

  if (convId) {
    for (const [uid, text, role] of [
      [ids.clientOwner, 'E2E TEST — Client: confirming sample delivery window.', 'client'],
      [ids.agencyOwner, 'E2E TEST — Agency: noted; board package updated.', 'agency'],
    ]) {
      const { error: mErr } = await admin.from('messages').insert({
        conversation_id: convId,
        sender_id: uid,
        text,
        metadata: { e2e_role: role, playwright_seed: true },
      });
      if (mErr) console.warn('[e2e-seed] messages:', mErr.message);
    }
  }

  // --- Notifications (org-targeted + user-targeted) ---
  const { error: n1 } = await admin.from('notifications').insert({
    organization_id: primaryAgencyOrgId,
    user_id: null,
    type: 'system',
    title: 'E2E TEST — notification (unread)',
    message: 'PLAYWRIGHT — synthetic org notification.',
    metadata: { seed: true },
    is_read: false,
  });
  if (n1) console.warn('[e2e-seed] notifications org:', n1.message);

  const { error: n2 } = await admin.from('notifications').insert({
    user_id: ids.clientOwner,
    organization_id: null,
    type: 'system',
    title: 'E2E TEST — inbox ping (read)',
    message: 'PLAYWRIGHT — read notification sample.',
    metadata: { seed: true },
    is_read: true,
  });
  if (n2) console.warn('[e2e-seed] notifications user:', n2.message);

  // --- Guest link (package) ---
  const pkgModels = modelRows.slice(0, 8).map((m) => m.id);
  const { error: glErr } = await admin.from('guest_links').insert({
    agency_id: primaryAgencyId,
    model_ids: pkgModels,
    agency_email: ACCOUNTS.agencyOwner.email,
    agency_name: 'E2E TEST — Northwind Models',
    label: 'PLAYWRIGHT — Portfolio showcase',
    created_by: ids.agencyOwner,
    type: 'portfolio',
    is_active: true,
    expires_at: null,
  });
  if (glErr) console.warn('[e2e-seed] guest_links:', glErr.message);

  // --- Recruiting application (applicant user) ---
  const { error: appErr } = await admin.from('model_applications').insert({
    applicant_user_id: ids.applicant,
    agency_id: primaryAgencyId,
    first_name: 'E2E',
    last_name: 'Applicant',
    age: 24,
    height: 180,
    gender: 'diverse',
    hair_color: 'Brown',
    city: 'Berlin',
    country_code: 'DE',
    ethnicity: 'PLAYWRIGHT test label',
    instagram_link: 'https://e2e-test.invalid/ig',
    images: {
      a: 'https://placehold.co/400x600/111/eee/png?text=E2E+Apply+A',
      b: 'https://placehold.co/400x600/222/ddd/png?text=E2E+Apply+B',
    },
    status: 'pending',
  });
  if (appErr) console.warn('[e2e-seed] model_applications:', appErr.message);

  // Persist id map for Playwright/docs automation
  const manifest = {
    generated_at: new Date().toISOString(),
    supabase_url_host: new URL(SUPABASE_URL).host,
    primary_agency_id: primaryAgencyId,
    primary_agency_org_id: primaryAgencyOrgId,
    primary_client_org_id: primaryClientOrgId,
    linked_model_id: linkedModelId,
    b2b_conversation_id: convId,
    first_client_project_id: projectIds[0] ?? null,
    option_requests: {
      option_id: optReqId ?? null,
      casting_id: castingOptionRequestId,
      unlinked_option_id: unlinkedOptionRequestId,
    },
    option_request_labels: {
      linked_job_description: E2E_OPTION_JOB_LINKED,
      casting_job_description: E2E_OPTION_JOB_CASTING,
      unlinked_job_description: E2E_OPTION_JOB_UNLINKED,
    },
    unlinked_model_id: unlinkedSeedReady ? unlinkedId : null,
    /** Model web deeplink: `/?booking=<uuid>` (see App.tsx). */
    model_booking_deeplink_param: optReqId ?? null,
    guest_link_model_sample: pkgModels.length,
    user_ids: ids,
    model_id_range: { from: modelRows[0].id, to: modelRows[modelRows.length - 1].id, count: modelRows.length },
  };
  const manifestPath = path.join(ROOT, 'docs', 'e2e-seed-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[e2e-seed] Wrote ${manifestPath}`);
  console.log('[e2e-seed] Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

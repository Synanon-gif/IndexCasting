/**
 * Role-specific static setup / product guidance for help_static.
 * No live data — deterministic answers only. English copy matches existing assistant tone.
 */

export type ViewerRole = 'agency' | 'client' | 'model';

export type HelpStaticSubtype =
  | 'general'
  | 'setup_guidance'
  | 'feature_explanation'
  | 'navigation_help'
  | 'troubleshooting_help';

export type DeterministicHelpResult = { answer: string; subtype: HelpStaticSubtype };

const AGENCY_NAV = [
  'Dashboard',
  'My Models',
  'Clients',
  'Messages',
  'Calendar',
  'Recruiting',
  'Team',
  'Links',
  'Billing',
  'Settings',
] as const;

const CLIENT_NAV = [
  'Dashboard',
  'Discover',
  'My Projects',
  'Messages',
  'Calendar',
  'Agencies',
  'Team',
  'Billing',
  'Profile',
] as const;

export function looksLikeLiveBillingDataRequest(normalized: string): boolean {
  const n = normalized.trim();
  if (/\b(mark|set)\b.*\binvoice\b.*\b(paid|unpaid)\b/i.test(n)) return true;
  if (
    /\b(show|list|give|get|display|export|download)\b.*\b(my|our|the)\s+(invoice|invoices|payments?)\b/i.test(
      n,
    )
  ) {
    return true;
  }
  if (/\b(my|our)\s+(invoice|invoices)\b.*\b(show|list|status|amount|total|balance)\b/i.test(n)) {
    return true;
  }
  if (/\bwhere\b.*\b(see|view|check)\b.*\b(my|our)\s+(invoice|invoices)\b/i.test(n)) return true;
  if (/\bhow\s+much\b.*\b(subscription|invoice|pay)\b/i.test(n)) return true;
  return false;
}

export function looksLikeLiveTeamDataRequest(normalized: string): boolean {
  const n = normalized.trim();
  if (/\b(list|show|give)\b.*\b(all\s+)?(team\s+)?members?\b/i.test(n)) return true;
  if (/\b(remove|delete)\b.*\b(member|invitation|invite)\b/i.test(n)) return true;
  return false;
}

/** When true, billing/team_management regex rows are skipped (route as help / live classifier instead). */
export function shouldExemptBillingOrTeamForbidden(normalized: string): boolean {
  if (!isEducationalOrNavigationalHelpQuestion(normalized)) return false;
  if (looksLikeLiveBillingDataRequest(normalized)) return false;
  if (looksLikeLiveTeamDataRequest(normalized)) return false;
  return true;
}

/** Educational / wayfinding phrasing: exempt from live billing & team_management forbidden routing. */
export function isEducationalOrNavigationalHelpQuestion(normalized: string): boolean {
  const n = normalized.trim();
  if (!n) return false;

  if (
    /\b(list|show|give|get|display|export|download)\s+(me\s+)?(my|our|the)\s+/i.test(n) &&
    /\b(invoice|invoices|payment|payments)\b/i.test(n)
  ) {
    return false;
  }
  if (/\b(how much|what\s+did\s+i\s+pay|my\s+balance|outstanding|unpaid\s+invoice)\b/i.test(n)) {
    return false;
  }

  return (
    /\b(explain|what\s+is|what\s+are|what\s+does|describe|tell\s+me\s+about|help\s+me\s+(set\s+up|with|understand)|set\s+up\s+my|onboard)\b/i.test(
      n,
    ) ||
    /\bhow\s+do\s+i\s+(use|open|find|access|get\s+to|set\s+up|start|create)\b/i.test(n) ||
    /\bwhere\s+(do|can)\s+i\s+(find|open|access|go|get\s+to|manage|make|create|invite)\b/i.test(n) ||
    /\bshow\s+me\s+how\b/i.test(n) ||
    /\bwhat\s+should\s+i\s+(do|start)\b/i.test(n) ||
    /\bwhat\s+(to\s+)?do\s+(first|now)\b/i.test(n) ||
    /\b(complete|finish)\b.*\b(billing|profile|setup|recipient)\b/i.test(n)
  );
}

export function isProductCalendarEducationQuestion(message: string): boolean {
  const n = message.trim();
  if (!/\bcalendar\b|kalender\b/i.test(n)) return false;

  if (/\b(today|tomorrow|this week|next week|next \d+ days?|\d{4}-\d{2}-\d{2})\b/i.test(n)) {
    return false;
  }
  if (/\bwhat\s+(do|does)\s+(i|we)\s+have\b/i.test(n)) return false;
  if (/\b(show|list)\s+(my|our)?\s*calendar\b/i.test(n) && /\b(for|on)\b/i.test(n)) return false;
  if (/\b(last|latest)\s+(calendar\s+)?(event|item|job|booking|option)\b/i.test(n)) return false;
  if (/\bnext\s+(calendar\s+)?event\b/i.test(n)) return false;
  if (/\bwhat\s+is\s+(booked|on)\b/i.test(n)) return false;
  if (/\bwho\s+is\s+booked\b/i.test(n)) return false;
  if (/\bwas\s+habe\s+ich\b|\bhabe\s+ich\s+jobs?\b|was\s+steht\s+im\s+kalender/i.test(n)) return false;

  return (
    /\b(explain|what\s+is|how\s+does|describe|tell\s+me\s+about|how\s+do\s+i\s+use|help\s+me\s+understand)\b/i.test(
      n,
    ) || /\b(filter|filters)\b/i.test(n)
  );
}

export function getHelpStaticSubtypeSnippet(role: ViewerRole, subtype: HelpStaticSubtype): string {
  if (subtype === 'general') return '';
  const lines: string[] = [`Current help mode: ${subtype.replace(/_/g, ' ')}.`];
  if (role === 'agency') {
    lines.push(`Main tabs: ${AGENCY_NAV.join(', ')}.`);
    lines.push(
      'Setup priority: (1) complete billing profile, (2) complete recipient data, (3) add or import models, (4) assign territories, (5) invite team if permitted, (6) connect clients and review requests, (7) use Calendar for options, castings, and private events, (8) use Billing for invoices and manual invoices.',
    );
  } else if (role === 'client') {
    lines.push(`Main tabs: ${CLIENT_NAV.join(', ')}.`);
    lines.push(
      'Setup priority: (1) complete profile and organization basics, (2) create or review projects, (3) connect with agencies, (4) use Calendar for requests and jobs, (5) review Billing when shown.',
    );
  } else {
    lines.push('Provide general, non-workspace-specific guidance only. No agency/client internal areas.');
  }
  lines.push('Do not claim you performed any action. No live data unless provided as facts.');
  return lines.join('\n');
}

function agencySetupChecklist(): string {
  return [
    '**Agency setup (recommended order)**',
    '1. Billing: open **Billing** — complete your **billing profile** (and any **recipient data** the UI asks for). Watch for in-app banners about incomplete billing or recipient details.',
    '2. Models: in **My Models**, use **Add model manually** or **Import package** (e.g. Mediaslide / Netwalk).',
    '3. Territories: **Assign territories** where your workflow uses them (same model roster context).',
    '4. Team: **Team** — invite colleagues **if your permissions allow** (the assistant cannot send invites).',
    '5. Clients: **Clients** — connect clients and review incoming requests when applicable.',
    '6. Calendar: **Calendar** — **Add Option**, **Add Casting**, **Private Event**, **Refresh**, and **filters** keep the schedule accurate.',
    '7. Billing operations: **Billing** — unified invoice overview, **manual invoices**, and profile maintenance.',
    '',
    '**What the assistant cannot do**',
    'It does not read hidden billing balances, perform writes, send invites, or expose other organizations’ data.',
  ].join('\n');
}

function clientSetupChecklist(): string {
  return [
    '**Client setup (recommended order)**',
    '1. **Profile** — complete your profile and organization basics.',
    '2. **My Projects** — create projects or review what your team shared.',
    '3. **Agencies** — connect with partner agencies.',
    '4. **Calendar** — review options, castings, and jobs that are visible to you.',
    '5. **Messages** — negotiate with agencies here.',
    '6. **Billing** — open **Billing** only when your workspace shows it; complete any **billing profile** steps the UI requests.',
    '',
    '**What the assistant cannot do**',
    'It does not add models (agency workflow), perform writes, or show hidden fees or other orgs’ data.',
  ].join('\n');
}

function modelGuestGeneral(): string {
  return [
    '**Model / guest guidance**',
    'This assistant only gives general product guidance here — not live setup state from your account.',
    'Use **Profile** and calendar areas shown in your app to complete what your booker or agency requests.',
    'For agency- or client-only tools (rosters, client billing, team invites), ask your agency contact.',
  ].join('\n');
}

/** Ordered matchers: first match wins. */
export function tryDeterministicSetupResponse(
  message: string,
  role: ViewerRole,
): DeterministicHelpResult | null {
  const n = message.trim();
  if (!n) return null;

  const norm = n.replace(/\s+/g, ' ');

  if (
    /\bwhere\b.*\b(manage|open|find|go)\b.*\b(billing)\b/i.test(norm) &&
    role !== 'model'
  ) {
    return {
      subtype: 'navigation_help',
      answer:
        role === 'agency'
          ? 'Open **Billing** from the bottom navigation (**Billing** tab). There you maintain your **billing profile**, **recipient data**, the unified **invoice overview**, and **manual invoices** where available.\n\nI cannot view or change live billing data for you.'
          : 'Open **Billing** from the bottom navigation when your Client workspace shows that tab. Complete any **billing profile** steps the UI highlights.\n\nI cannot access private billing totals here.',
    };
  }

  if (/\bwhere\b.*\binvite\b/i.test(norm) && /\b(booker|team|staff|member|colleague)\b/i.test(norm)) {
    return {
      subtype: 'navigation_help',
      answer:
        'Invitations for bookers or staff are handled in **Team** — **when your permissions allow** sending invites.\n\n**Next:** open **Team** and use the invite flow shown there. If **Team** is missing, ask an organization owner.\n\nThis assistant cannot send invitations or change membership.',
    };
  }

  // ——— Cross-role firewall (specific questions) ———
  if (
    role === 'client' &&
    /\b(add|import|create)\s+(a\s+)?model|\bmy\s+models\b|add\s+model\s+manually|import\s+package|assign\s+territor(y|ies)|roster\s+share/i.test(
      norm,
    )
  ) {
    return {
      subtype: 'navigation_help',
      answer:
        'Adding, importing, and roster management for models is done in the **Agency** workspace (e.g. **My Models**, imports, territories). A **Client** workspace does not include those agency tools. If you work with models, ask your agency to manage the roster, or switch to an agency login when that is your role.',
    };
  }

  if (role === 'agency' && /\bdiscover\b/i.test(norm) && /\b(explain|what\s+is|how|where)\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        '**Discover** is a **Client** workspace tab for browsing visible agencies and models. It is **not** part of the Agency navigation. As an agency, use **Clients**, **Calendar**, and **My Models** instead.',
    };
  }

  // ——— Agency: prioritized “first steps” ———
  if (
    role === 'agency' &&
    (/\bhelp\s+me\s+set\s+up(\s+my)?\s+agenc(y|ies)/i.test(norm) ||
      /\b(set\s+up|setup)\s+(my\s+)?agenc(y|ies)/i.test(norm))
  ) {
    return { subtype: 'setup_guidance', answer: agencySetupChecklist() };
  }

  if (
    role === 'agency' &&
    (/\bwhat\s+should\s+i\s+do\s+first\b/i.test(norm) ||
      /\bwhat\s+to\s+do\s+first\b/i.test(norm) ||
      /\bfirst\s+steps?\b/i.test(norm))
  ) {
    return {
      subtype: 'setup_guidance',
      answer:
        '**Start here (Agency)**\n1. **Billing** — finish **billing profile** and **recipient data** (watch banners).\n2. **My Models** — add or **Import package** models.\n3. **Assign territories** if you use them.\n4. **Team** — invite colleagues **if allowed**.\n5. **Clients** & **Messages** — connect and review requests.\n6. **Calendar** — **Add Option** / **Add Casting** / **Private Event**; use **filters** and **Refresh**.\n7. **Billing** — **manual invoices** and unified invoice overview when needed.\n\nI cannot complete these steps for you or read hidden billing data.',
    };
  }

  // ——— Client: prioritized “first steps” ———
  if (role === 'client' && /\bhelp\s+me\s+set\s+up(\s+my)?\s+client/i.test(norm)) {
    return { subtype: 'setup_guidance', answer: clientSetupChecklist() };
  }

  if (
    role === 'client' &&
    (/\bwhat\s+should\s+i\s+do\s+first\b/i.test(norm) || /\bwhat\s+to\s+do\s+first\b/i.test(norm))
  ) {
    return {
      subtype: 'setup_guidance',
      answer:
        '**Start here (Client)**\n1. **Profile** — organization basics.\n2. **My Projects** — create or review projects.\n3. **Agencies** — connect with agencies.\n4. **Discover** — browse only what is visible to you.\n5. **Calendar** — review options, castings, and jobs.\n6. **Messages** — communicate with agencies.\n7. **Billing** — if visible, complete any **billing profile** prompts.\n\nI cannot perform actions or see private billing details.',
    };
  }

  // ——— Feature: My Models (Agency) ———
  if (role === 'agency' && /\bhow\s+do\s+i\s+add\s+models?\b/i.test(norm)) {
    return {
      subtype: 'navigation_help',
      answer:
        'Add models from **My Models**: use **Add model manually** for a single profile, or **Import package** (e.g. Mediaslide / Netwalk) for a bulk roster import.\n\n**Next:** open **My Models** and choose the matching action.\n\nI cannot create or import models for you.',
    };
  }

  if (role === 'agency' && /\bexplain\s+my\s+models\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        '**My Models** (Agency tab) is your roster: add or import models, open a model for profile and media, and manage roster workflows your permissions allow.\n\n**Next:** use **Add model manually** for one-off entries or **Import package** for Mediaslide / Netwalk packages. Optional: **Assign territories** or **Roster shares** when your workflow uses them.\n\nI cannot add or change models for you.',
    };
  }

  if (role === 'agency' && /\badd\s+model\s+manually\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        '**Add model manually** creates a **single model** record in **My Models** without a bulk import. Open **My Models**, choose **Add model manually**, then fill the fields the form shows (name, measurements, etc.).\n\n**Next:** save, then attach media or connect the profile as your process requires. For many models at once, use **Import package** instead.\n\nI cannot create the model for you.',
    };
  }

  if (role === 'agency' && /\bimport\s+package\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        '**Import package** brings in models from an external **package file** (commonly **Mediaslide** or **Netwalk**) into **My Models** in bulk.\n\n**Next:** open **My Models**, start **Import package**, select the correct provider/format, upload the package, and review the import summary before confirming.\n\nI cannot run an import for you.',
    };
  }

  if (role === 'agency' && /\bassign\s+territor(y|ies)\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        '**Assign territories** links models (or roster entries) to geographic or market **territories** your agency uses — so assignments stay consistent across the roster and downstream workflows.\n\n**Next:** open the territory assignment flow from **My Models** / roster context (as labeled in the UI) and pick territories per model. Exact placement can depend on your agency configuration.\n\nI cannot change territory data for you.',
    };
  }

  // ——— Options / calendar ———
  if (
    role === 'agency' &&
    /\bwhere\b.*\b(create|add|make)\b.*\boption\b/i.test(norm)
  ) {
    return {
      subtype: 'navigation_help',
      answer:
        'Create **options** from **Calendar** (Agency): open **Calendar**, tap **Add Option**, complete the model, client, and time fields, then save. The item appears on the calendar — not via a separate “roster-only” action.\n\nI cannot create the option for you.',
    };
  }

  if (
    /\bwhere\b.*\b(manual\s+invoice|create\s+.*\binvoice)\b/i.test(norm) &&
    role === 'agency'
  ) {
    return {
      subtype: 'navigation_help',
      answer:
        '**Manual invoices** are created under **Billing** in the Agency workspace. Open **Billing**, use the **manual invoice** flow (labels match the UI), and complete recipients and line items there — not in Calendar or **My Models**.\n\nI cannot create invoices.',
    };
  }

  // ——— Billing education (static only) ———
  if (/\bwhat\s+does\b.*\b(open|paid|problem)\b/i.test(norm) && /\b(invoice|status|tracking)\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        '**Open**, **Paid**, and **Problem** in invoice tracking are **internal status labels** for your organization’s follow-up — not something to share as a client-facing payment guarantee. They help teams see what still needs action versus what cleared or needs attention.\n\nOpen **Billing** to view details in the product. I cannot see live invoice status here.',
    };
  }

  if (role === 'agency' && /\bexplain\s+billing\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        '**Billing** (Agency) covers your **billing profile**, **recipient data**, a **unified invoice overview**, and tools to issue **manual invoices** where your plan allows.\n\n**Next:** complete any banner prompts for missing profile or recipient fields, then use the overview for tracking. **Open / Paid / Problem** are internal tracking states only.\n\nI cannot read balances, change settings, or create invoices.',
    };
  }

  if (role === 'client' && /\bexplain\s+billing\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        '**Billing** (Client) appears when your workspace uses it: usually **billing profile** completion and viewing client-side invoice context your agency shares — **not** agency model roster billing.\n\n**Next:** follow any in-app prompts. I cannot access live invoice amounts or pay on your behalf.',
    };
  }

  if (/\bwhat\s+do\s+i\s+need\s+to\s+finish\b.*\b(billing|invoice)\b/i.test(norm) || /\bfinish\s+billing\s+setup\b/i.test(norm)) {
    if (role === 'agency') {
      return {
        subtype: 'setup_guidance',
        answer:
          'Finish **Billing** setup by completing everything **Billing** still flags: typically **billing profile** fields and **recipient data** (watch in-app banners). The exact checklist is in the **Billing** screens.\n\n**Next:** open **Billing** and resolve each highlighted section.\n\nI cannot see which field is incomplete for your account.',
      };
    }
    if (role === 'client') {
      return {
        subtype: 'setup_guidance',
        answer:
          'Complete any **Billing** prompts your **Client** workspace shows — usually **billing profile** or recipient details for your organization.\n\n**Next:** open **Billing** from the bottom navigation when visible and follow the missing items.\n\nI cannot see your live completion state.',
      };
    }
  }

  // ——— Client: Discover / My Projects / Calendar bookings ———
  if (role === 'client' && /\bexplain\s+discover\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        '**Discover** lets you browse **agencies and models that are visible** to your client workspace (according to permissions and sharing).\n\n**Next:** open a card to start a project flow or request when the UI offers it.\n\nI cannot show models that are not visible to you.',
    };
  }

  if (role === 'client' && /\bexplain\s+my\s+projects\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        '**My Projects** organizes your client-side work: create or review **projects**, track selections, and continue agency conversations tied to those projects.\n\n**Next:** add a project or open an existing one, then use **Messages** or **Calendar** from there as needed.\n\nI cannot create a project for you.',
    };
  }

  if (role === 'client' && /\bwhere\b.*\b(review\s+)?bookings?\b/i.test(norm)) {
    return {
      subtype: 'navigation_help',
      answer:
        'Review bookings and visible jobs in **Calendar** (Client): confirmed **bookings**, **options**, **castings**, and related items appear on the timeline when your agencies share them.\n\nI cannot list live bookings here.',
    };
  }

  if (role === 'client' && /\bexplain\s+calendar\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        '**Calendar** (Client) shows **options**, **castings**, and **jobs** your connected agencies expose — a single place to review timing and status at a glance.\n\n**Next:** tap an entry for details in the app. Use **Messages** for negotiation.\n\nI cannot fetch your live calendar here unless the server provides a summary.',
    };
  }

  if (role === 'agency' && /\bexplain\s+calendar\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        '**Calendar** (Agency) is the hub for **Add Option**, **Add Casting**, **Private Event**, **Refresh**, and **filters**. Options and castings are created **here**, then follow your workflow toward confirmations.\n\n**Next:** use filters to focus clients or models, refresh after roster changes, and add events from the **+** actions.\n\nI cannot change your calendar for you.',
    };
  }

  if (role === 'model' && /\bexplain\s+calendar\b/i.test(norm)) {
    return {
      subtype: 'feature_explanation',
      answer:
        'Your **Calendar** shows timing your agency shares — for example options, castings, or bookings **when visible** to your account.\n\n**Next:** open entries in the app for details. I cannot load live calendar rows here.',
    };
  }

  if (/\bcalendar\s+filter|\bfilter(s)?\b.*\bcalendar\b/i.test(norm) && role !== 'model') {
    return {
      subtype: 'feature_explanation',
      answer:
        '**Calendar filters** narrow which entries you see (for example by client, model, or type), so busy rosters stay readable.\n\n**Next:** open **Calendar** and use the filter control shown in the header or sheet.\n\nFilters only change the view — they do not delete data.',
    };
  }

  // ——— Team onboarding (static) ———
  if (/\bhow\s+do\s+i\s+onboard\s+my\s+team\b/i.test(norm) || /\bonboard\s+my\s+team\b/i.test(norm)) {
    return {
      subtype: 'setup_guidance',
      answer:
        'Onboarding teammates uses **Team**: invite colleagues **if your role and organization allow invites**. Complete each invite in the UI (email, role, permissions as shown).\n\n**Important:** this assistant **cannot** send invitations or verify pending members.\n\nIf you do not see **Team**, your account may lack permission — ask an owner or admin in your organization.',
    };
  }

  if (role === 'model') {
    if (
      /\b(help\s+me\s+set\s+up|set\s+up\s+my\s+account|what\s+should\s+i\s+do\s+first)\b/i.test(norm)
    ) {
      return { subtype: 'setup_guidance', answer: modelGuestGeneral() };
    }
  }

  // Generic “explain this page” / account setup → role checklist
  if (/\bhelp\s+me\s+set\s+up\s+my\s+account\b/i.test(norm) || /\bexplain\s+this\s+page\b/i.test(norm)) {
    if (role === 'agency') return { subtype: 'setup_guidance', answer: agencySetupChecklist() };
    if (role === 'client') return { subtype: 'setup_guidance', answer: clientSetupChecklist() };
    return { subtype: 'setup_guidance', answer: modelGuestGeneral() };
  }

  return null;
}

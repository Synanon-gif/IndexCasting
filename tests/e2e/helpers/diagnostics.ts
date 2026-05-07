import type { ConsoleMessage, Page, Request, Response, TestInfo } from '@playwright/test';
import { getCheckpointReport } from './checkpoints';
import { getE2eDiagnosticContext } from './e2eDiagnosticContext';
import {
  classifyBaseUrlForDiagnostics,
  isWriteTestAllowed,
  writeGateBlockedDetail,
  type E2EWriteKind,
} from './env';
import { redactCookieLike, redactJwtLike, redactUrl } from './redact';

export type ConsoleEntry = { type: string; text: string; location?: string };
export type NetworkEntry = {
  url: string;
  method: string;
  status?: number;
  failure?: string;
};

export type DiagnosticPayload = {
  title: string;
  project: string;
  lastUrl: string;
  console: ConsoleEntry[];
  pageErrors: string[];
  networkFailures: NetworkEntry[];
};

function pushUniqueNet(entries: NetworkEntry[], row: NetworkEntry, cap = 200): void {
  const key = `${row.method} ${row.url} ${row.status ?? ''}`;
  if (entries.some((e) => `${e.method} ${e.url} ${e.status ?? ''}` === key)) return;
  if (entries.length >= cap) entries.shift();
  entries.push(row);
}

/**
 * Attach DevTools-style diagnostics for a test. Call returned teardown after the test body.
 */
export function startPageDiagnostics(page: Page, testInfo: TestInfo): () => Promise<void> {
  const consoleMessages: ConsoleEntry[] = [];
  const pageErrors: string[] = [];
  const networkFailures: NetworkEntry[] = [];

  const onConsole = (msg: ConsoleMessage) => {
    const locUrl = msg.location()?.url;
    consoleMessages.push({
      type: msg.type(),
      text: redactCookieLike(redactJwtLike(msg.text())),
      location: locUrl ? redactUrl(redactJwtLike(locUrl)) : undefined,
    });
  };
  const onPageError = (err: Error) => {
    pageErrors.push(redactCookieLike(redactJwtLike(err.message)));
  };
  const onRequestFailed = (req: Request) => {
    pushUniqueNet(networkFailures, {
      url: redactUrl(req.url()),
      method: req.method(),
      failure: req.failure()?.errorText ?? undefined,
    });
  };
  const onResponse = (res: Response) => {
    const status = res.status();
    if (status >= 400) {
      pushUniqueNet(networkFailures, {
        url: redactUrl(res.url()),
        method: res.request().method(),
        status,
      });
    }
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  return async () => {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);

    const viewport = page.viewportSize();

    const payload: DiagnosticPayload = {
      title: testInfo.title,
      project: testInfo.project.name,
      lastUrl: redactUrl(page.url()),
      console: consoleMessages,
      pageErrors,
      networkFailures,
    };

    await testInfo.attach('diagnostics.json', {
      body: Buffer.from(JSON.stringify({ ...payload, viewport }, null, 2)),
      contentType: 'application/json',
    });

    if (testInfo.status !== testInfo.expectedStatus) {
      const attachBase = testInfo.outputDir;
      const { checkpoints, lastClickLabel } = getCheckpointReport();

      const byStatus = new Map<number | string, number>();
      for (const n of networkFailures) {
        const k = n.status ?? (n.failure ? 'failed' : '?');
        byStatus.set(k, (byStatus.get(k) ?? 0) + 1);
      }
      const netGrouped = [...byStatus.entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([k, c]) => `- ${k}: ${c} request(s)`);

      let storageKeys: { local: string[]; session: string[] } = { local: [], session: [] };
      let headings: string[] = [];
      let buttonLabels: string[] = [];
      let linkLabels: string[] = [];
      try {
        storageKeys = await page.evaluate(() => ({
          local: Object.keys(window.localStorage).sort(),
          session: Object.keys(window.sessionStorage).sort(),
        }));
        headings = (await page.locator('h1, h2, h3').allTextContents())
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 25);
        buttonLabels = (await page.locator('button, [role="button"]').allTextContents())
          .map((t) => t.replace(/\s+/g, ' ').trim())
          .filter((t) => t.length > 0 && t.length < 80)
          .slice(0, 20);
        linkLabels = (await page.locator('a[href]').allTextContents())
          .map((t) => t.replace(/\s+/g, ' ').trim())
          .filter((t) => t.length > 0 && t.length < 80)
          .slice(0, 20);
      } catch {
        // page may be closed
      }

      const consoleByType = new Map<string, number>();
      for (const c of consoleMessages) {
        consoleByType.set(c.type, (consoleByType.get(c.type) ?? 0) + 1);
      }
      const consoleGrouped = [...consoleByType.entries()].map(([t, n]) => `- ${t}: ${n}`);

      const has5xx = networkFailures.some((n) => (n.status ?? 0) >= 500);
      const has4xx = networkFailures.some((n) => (n.status ?? 0) >= 400 && (n.status ?? 0) < 500);
      let guess =
        '- **selector-gap** — likely if timeouts dominate and last click looks UI-related.';
      if (has5xx) guess = '- **env-gap** — 5xx responses; check host/base URL and CDN.';
      else if (pageErrors.length > 0 && networkFailures.length < 5)
        guess = '- **app-bug** candidate — page errors with few HTTP failures.';
      else if (has4xx && networkFailures.some((n) => n.url.includes('supabase')))
        guess = '- **seed-gap** or **auth-gap** — Supabase 4xx; session, RLS, or missing rows.';

      let routePathname = '(unknown)';
      try {
        routePathname = new URL(page.url()).pathname || '/';
      } catch {
        routePathname = '(unparseable)';
      }

      const dCtx = getE2eDiagnosticContext();
      const baseUrlClass = classifyBaseUrlForDiagnostics();
      let writeGateLine = 'not applicable';
      const wk = dCtx.writeKind;
      if (wk === 'chat' || wk === 'option_lifecycle') {
        const kind = wk as E2EWriteKind;
        writeGateLine = isWriteTestAllowed(kind)
          ? 'allowed'
          : `blocked — ${writeGateBlockedDetail(kind)}`;
      } else if (wk === 'read' || wk === 'none') {
        writeGateLine = 'not applicable';
      }

      const md = [
        '# E2E failure diagnostic summary',
        '',
        `- **Test:** ${testInfo.title}`,
        `- **roleKey:** ${dCtx.roleKey ?? '(not set)'}`,
        `- **emailDomainHint:** ${dCtx.emailDomainHint ?? '(not set)'}`,
        `- **writeKind (harness):** ${dCtx.writeKind ?? 'none'}`,
        `- **baseUrl class:** ${baseUrlClass}`,
        `- **writeGate:** ${writeGateLine}`,
        `- **Project / browser:** ${testInfo.project.name}`,
        `- **Viewport:** ${viewport ? `${viewport.width}×${viewport.height}` : 'unknown'}`,
        `- **Last URL:** ${payload.lastUrl}`,
        `- **Route (pathname):** ${routePathname}`,
        `- **Last successful checkpoints:** ${checkpoints.length ? checkpoints.join(' | ') : '(none recorded — add checkpoint(testInfo, ...) in test)'}`,
        `- **Last click label:** ${lastClickLabel || '(none)'}`,
        `- **Artifacts:** Playwright outputDir \`${attachBase}\``,
        `- **Typical files (under outputDir):** \`test-failed-1.png\`, \`trace.zip\`, \`video.webm\` (names depend on project config)`,
        `- **Console messages:** ${consoleMessages.length}`,
        `- **Page errors:** ${pageErrors.length}`,
        `- **Network failures (4xx/5xx/requestfailed):** ${networkFailures.length}`,
        '',
        '## Suspected category (heuristic)',
        '',
        guess,
        '',
        '## Storage keys (names only; values never logged)',
        '',
        `- localStorage (${storageKeys.local.length}): ${storageKeys.local.slice(0, 40).join(', ') || '—'}`,
        `- sessionStorage (${storageKeys.session.length}): ${storageKeys.session.slice(0, 40).join(', ') || '—'}`,
        '',
        '## Visible headings (sample)',
        ...headings.map((h) => `- ${h.slice(0, 120)}`),
        '',
        '## Visible button-like text (sample, max 20)',
        ...buttonLabels.map((b) => `- ${b.slice(0, 120)}`),
        '',
        '## Visible link text (sample, max 20)',
        ...linkLabels.map((l) => `- ${l.slice(0, 120)}`),
        '',
        '## Network grouped by status / failure kind',
        ...netGrouped,
        '',
        '## Console grouped by type',
        ...consoleGrouped,
        '',
        '## Page errors',
        ...pageErrors.map((e) => `- ${e}`),
        '',
        '## Network failures (sample)',
        ...networkFailures
          .slice(0, 40)
          .map((n) => `- ${n.method} ${n.status ?? ''} ${n.url}${n.failure ? ` — ${n.failure}` : ''}`),
        '',
        '## Console (last 30)',
        ...consoleMessages.slice(-30).map((c) => `- [${c.type}] ${c.text}`),
        '',
      ].join('\n');

      await testInfo.attach('failure-summary.md', {
        body: Buffer.from(md, 'utf8'),
        contentType: 'text/markdown',
      });
    }
  };
}

/** Canonical product web entry — keep apex / www traffic on the existing Expo web deployment. */
const APP_ORIGIN = 'https://www.index-casting.com';

export function App() {
  return (
    <div className="page">
      <header className="shell">
        <div className="hero">
          <div className="eyebrow">Index Casting · Marketing preview</div>
          <h1>B2B operating system for fashion castings.</h1>
          <p className="lede">
            Swipe-fast discovery for clients, WhatsApp-speed messaging, and calendars that mirror real options,
            castings, and jobs — scoped to enterprise-grade privacy.
          </p>
          <div className="actions">
            {/* Auth and product UX stay on the existing web app deployment. */}
            <a className="btn btnPrimary" href={`${APP_ORIGIN}/`} rel="noopener noreferrer">
              Open the Index Casting web app
            </a>
            <a className="btn btnGhost" href={`${APP_ORIGIN}/trust`} rel="noopener noreferrer">
              Trust Center
            </a>
          </div>
          <div className="note" role="note">
            This page is intentionally isolated from the authenticated product. Deploy it only at{' '}
            <strong>web.index-casting.com</strong> using a dedicated Vercel project (do not remap the apex app).
          </div>
        </div>
      </header>
      <footer className="shell footer">
        <span>Landing scaffold — customize copy and OG image before GA.</span>
        <span>Sitemap — /sitemap.xml · Robots — /robots.txt</span>
      </footer>
    </div>
  );
}

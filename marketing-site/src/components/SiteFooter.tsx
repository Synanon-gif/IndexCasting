import { APP_ORIGIN, EARLY_ACCESS_EMAIL, LANDING_ORIGIN } from '../constants';

export function SiteFooter() {
  return (
    <footer className="siteFooter">
      <div className="shell siteFooterInner">
        <div className="siteFooterBrand">
          <span className="siteFooterName">Index Casting</span>
          <span className="siteFooterTag">Connected casting infrastructure · built in Germany</span>
          <p className="siteFooterEarly">
            Early agency teams:{' '}
            <a href={`mailto:${EARLY_ACCESS_EMAIL}?subject=Index%20Casting%20—%20early%20access`}>
              {EARLY_ACCESS_EMAIL}
            </a>
          </p>
        </div>
        <div className="siteFooterLinks">
          <a href={`${APP_ORIGIN}/`} rel="noopener noreferrer">
            Product
          </a>
          <a href={`${APP_ORIGIN}/trust`} rel="noopener noreferrer">
            Trust &amp; data
          </a>
          <a href={`${LANDING_ORIGIN}/sitemap.xml`}>Sitemap</a>
        </div>
      </div>
    </footer>
  );
}

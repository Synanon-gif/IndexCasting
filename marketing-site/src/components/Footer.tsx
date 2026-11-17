import { APP_ORIGIN, EARLY_ACCESS_EMAIL, LANDING_ORIGIN } from '@/constants';

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-8 px-5 py-12 md:flex-row md:items-end md:justify-between md:px-8">
        <div className="max-w-sm">
          <p className="label text-[12px] tracking-[0.2em]">Index Casting</p>
          <p className="mt-3 text-sm text-muted-foreground">
            Connected casting infrastructure. Built in Innsbruck.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Early agency teams:{' '}
            <a
              className="font-medium text-foreground underline decoration-line underline-offset-4 hover:decoration-foreground"
              href={`mailto:${EARLY_ACCESS_EMAIL}?subject=Index%20Casting%20—%20early%20access`}
            >
              {EARLY_ACCESS_EMAIL}
            </a>
          </p>
        </div>
        <nav aria-label="Footer" className="flex gap-6 text-sm">
          <a className="hover:underline" href={`${APP_ORIGIN}/`} rel="noopener noreferrer">
            Product
          </a>
          <a className="hover:underline" href={`${APP_ORIGIN}/trust`} rel="noopener noreferrer">
            Trust &amp; data
          </a>
          <a className="hover:underline" href={`${LANDING_ORIGIN}/sitemap.xml`}>
            Sitemap
          </a>
        </nav>
      </div>
    </footer>
  );
}

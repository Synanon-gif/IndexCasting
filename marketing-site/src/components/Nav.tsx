import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { APP_ORIGIN } from '@/constants';
import { cn } from '@/lib/utils';

const links = [
  { href: '#agencies', label: 'Agencies' },
  { href: '#clients', label: 'Clients' },
  { href: '#models', label: 'Models' },
  { href: '#trust', label: 'Trust' },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 bg-background transition-[border-color] duration-300',
        scrolled ? 'border-b border-line' : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 md:px-8">
        <a href="#top" className="label text-[12px] tracking-[0.2em]" aria-label="Index Casting — top">
          Index Casting
        </a>
        <nav aria-label="Sections" className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <Button asChild size="sm" className="rounded-full px-4">
          <a href={`${APP_ORIGIN}/`} rel="noopener noreferrer">
            Open app
          </a>
        </Button>
      </div>
    </header>
  );
}

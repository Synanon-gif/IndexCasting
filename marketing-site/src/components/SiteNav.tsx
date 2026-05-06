import { motion, useReducedMotion } from 'framer-motion';
import { APP_ORIGIN } from '../constants';
import { useActiveSection } from '../hooks/useActiveSection';

const links = [
  { href: '#problem', id: 'problem' as const, label: 'Friction' },
  { href: '#agency', id: 'agency' as const, label: 'Agency' },
  { href: '#clients', id: 'clients' as const, label: 'Clients' },
  { href: '#models', id: 'models' as const, label: 'Models' },
  { href: '#trust', id: 'trust' as const, label: 'Trust' },
];

const easePremium = [0.16, 1, 0.3, 1] as const;

export function SiteNav() {
  const reduceMotion = useReducedMotion() ?? false;
  const active = useActiveSection();

  const inner = (
    <div className="siteNavInner">
      <div className="siteNavPrimary">
        <a className="siteNavLogo" href="#top">
          Index Casting
        </a>
        <a className="siteNavCta" href={`${APP_ORIGIN}/`} rel="noopener noreferrer">
          Open app
        </a>
      </div>
      <nav className="siteNavScroller" aria-label="Sections" role="navigation">
        <div className="siteNavScrollerTrack">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`siteNavLink${active === l.id ? ' siteNavLinkActive' : ''}`}
              aria-current={active === l.id ? true : undefined}
            >
              {l.label}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );

  if (reduceMotion) {
    return <header className="siteNav">{inner}</header>;
  }

  return (
    <motion.header
      className="siteNav"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.72, ease: easePremium }}
    >
      {inner}
    </motion.header>
  );
}

import { useEffect, useState } from 'react';

/** Section `id`s that match nav hash links (without #). */
const SECTION_IDS = ['problem', 'agency', 'clients', 'models', 'trust', 'cta'] as const;

export type ActiveSectionId = (typeof SECTION_IDS)[number] | null;

/**
 * Tracks which marketing section is most visible for nav highlighting.
 * Fail-safe: stays null until first intersect; no DOM writes.
 */
export function useActiveSection(): ActiveSectionId {
  const [active, setActive] = useState<ActiveSectionId>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      return;
    }

    const els = SECTION_IDS.map((id) => document.getElementById(id)).filter(
      (n): n is HTMLElement => n !== null,
    );
    if (els.length === 0) return;

    const visible = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id;
          if (!id) continue;
          if (e.isIntersecting) {
            visible.set(id, e.intersectionRatio);
          } else {
            visible.delete(id);
          }
        }

        let best: ActiveSectionId = null;
        let bestScore = -1;
        for (const [id, ratio] of visible) {
          const el = document.getElementById(id);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const navReserve = 120;
          const overlap = Math.max(
            0,
            Math.min(r.bottom, window.innerHeight) - Math.max(r.top, navReserve),
          );
          const score = overlap * 0.7 + ratio * 0.3 * r.height;
          if (score > bestScore) {
            bestScore = score;
            best = id as ActiveSectionId;
          }
        }

        setActive((prev) => (best !== prev ? best : prev));
      },
      {
        root: null,
        rootMargin: '-96px 0px -45% 0px',
        threshold: [0.08, 0.15, 0.25, 0.35, 0.5],
      },
    );

    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return active;
}

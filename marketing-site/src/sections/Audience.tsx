import type { ReactNode } from 'react';
import { Heading } from '@/components/Heading';
import { BlurFade } from '@/components/ui/blur-fade';
import { cn } from '@/lib/utils';
import { AgencyScene } from '@/scenes/AgencyScene';
import { ClientScene } from '@/scenes/ClientScene';
import { ModelScene } from '@/scenes/ModelScene';

type Block = {
  id: string;
  who: string;
  title: string;
  lead: string;
  points: string[];
  closing?: string;
  scene: ReactNode;
  flip?: boolean;
  tint?: boolean;
};

const blocks: Block[] = [
  {
    id: 'agencies',
    who: 'For agencies',
    title: 'Built for speed, without losing control.',
    lead: 'One connected system around production: roster, recruiting, client comms and calendars. The field as it is, not rebuilt from five threads.',
    points: [
      'Roster & territories',
      'Recruiting pipeline',
      'Live calendars & holds',
      'Client rooms & projects',
      'Bookings through confirmation',
      'Built-in assistance layer',
    ],
    closing: 'Less re-syncing. Fewer handover mistakes. Clients move faster, and you keep the relationship.',
    scene: <AgencyScene />,
  },
  {
    id: 'clients',
    who: 'For clients & productions',
    title: 'Visual discovery. Faster decisions.',
    lead: 'Swipe-speed exploration, not a gimmick. Fewer PDFs, fewer WhatsApp chains. Agencies stay in the thread with context intact.',
    points: ['Visual-first and decisive', 'Projects stay legible', 'Agencies linked, thread intact', 'Holds & confirmations visible'],
    scene: <ClientScene />,
    flip: true,
  },
  {
    id: 'models',
    who: 'For models',
    title: 'The modern entrance.',
    lead: 'Visibility with real agencies. Applications land where bookers work. Inbox, calendar and threads on your phone, one spine.',
    points: ['Seen by working bookers', 'Recruiting & apply paths', 'Agency chat stays connected', 'Pocket parity with the desk'],
    scene: <ModelScene />,
  },
];

export function Audience() {
  return (
    <div>
      {blocks.map((b) => (
        <section
          key={b.id}
          id={b.id}
          className={cn('border-t border-line', b.tint && 'bg-secondary/50')}
        >
          <div className="mx-auto grid max-w-[1280px] items-center gap-12 px-5 py-20 md:px-8 md:py-32 lg:grid-cols-2 lg:gap-24">
            <div className={cn(b.flip && 'lg:order-2')}>
              <p className="mb-4 text-sm font-medium text-primary">{b.who}</p>
              <Heading text={b.title} className="text-[clamp(2.2rem,4.6vw,4rem)]" />
              <BlurFade inView delay={0.1}>
                <p className="mt-6 max-w-[48ch] text-lg leading-relaxed text-muted-foreground">{b.lead}</p>
                <ul className="mt-8 grid gap-x-8 sm:grid-cols-2">
                  {b.points.map((p) => (
                    <li key={p} className="border-t border-line py-3 text-[15px]">
                      {p}
                    </li>
                  ))}
                </ul>
                {b.closing && <p className="mt-6 max-w-[48ch] text-[15px] text-muted-foreground">{b.closing}</p>}
              </BlurFade>
            </div>
            <div className={cn(b.flip && 'lg:order-1')}>{b.scene}</div>
          </div>
        </section>
      ))}
    </div>
  );
}

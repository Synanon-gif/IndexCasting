import { useRef } from 'react';
import { AnimatePresence, motion, useInView } from 'motion/react';
import { CalendarDays, Check, Inbox, Search, Send, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SampleNote, StatusPill } from './ui';
import { useCycle } from './useCycle';

const tabs = [
  { i: Inbox, l: 'Inbox' },
  { i: CalendarDays, l: 'Calendar' },
  { i: Search, l: 'Discover' },
  { i: Send, l: 'Requests' },
  { i: User, l: 'Profile' },
];

/** Model phone: a request lands, the model approves, the agency is notified. */
export function ModelScene() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '-15% 0px' });
  const s = useCycle(3, 2700, inView); // 0 incoming, 1 pressing accept, 2 approved

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[330px]" aria-hidden="true">
      <div className="relative aspect-[9/18.5] overflow-hidden rounded-[2.4rem] border-[7px] border-[#151515] bg-card shadow-[0_40px_80px_-30px_rgba(17,17,17,0.45)]">
        <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold">
          <span className="num">9:41</span>
          <span className="h-1.5 w-12 rounded-full bg-[#151515]" />
          <span className="text-[9px]">100%</span>
        </div>

        <div className="relative mx-3 mt-1 h-[43%] overflow-hidden rounded-2xl">
          <img
            src="/images/editorial/smile.jpg"
            alt=""
            width={1000}
            height={1165}
            loading="lazy"
            decoding="async"
            className="size-full object-cover object-[50%_25%]"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-3 pb-2.5 pt-10 text-white">
            <p className="text-[13px] font-semibold tracking-wide">RUBEN E</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-white/75">Innsbruck, AT</p>
          </div>
        </div>

        <div className="px-4 pt-3">
          <AnimatePresence mode="wait" initial={false}>
            {s < 2 ? (
              <motion.div
                key="req"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center justify-between">
                  <p className="label text-[9px]">New option request</p>
                  <StatusPill status="action" />
                </div>
                <p className="num mt-2 text-[12px] font-medium">Mon 23 Nov · 09:00–10:00</p>
                <p className="text-[11px] text-muted-foreground">Client 3 · Runway / campaign</p>
                <div className="mt-3 flex gap-2">
                  <span className="label flex-1 rounded-full border border-border py-2 text-center text-[9px]">Decline</span>
                  <span
                    className={cn(
                      'label flex-1 rounded-full bg-primary py-2 text-center text-[9px] text-white transition-transform duration-300',
                      s === 1 && 'scale-95 bg-[#123528]',
                    )}
                  >
                    Accept
                  </span>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="ok"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-2">
                  <span className="grid size-6 place-items-center rounded-full bg-primary text-white">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                  <p className="text-[13px] font-semibold">Approved</p>
                  <StatusPill status="approved" className="ml-auto" />
                </div>
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  Your agency was notified. Calendar and thread are updated.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex justify-around border-t border-border bg-card px-2 pb-3 pt-2">
          {tabs.map(({ i: Icon, l }) => (
            <span key={l} className={cn('flex flex-col items-center gap-0.5 text-[8px]', l === 'Requests' ? 'text-foreground' : 'text-muted-foreground')}>
              <Icon className="size-4" strokeWidth={1.6} />
              {l}
            </span>
          ))}
        </div>
      </div>
      <SampleNote className="mt-3 text-center" />
    </div>
  );
}

import { Marquee } from '@/components/ui/marquee';

const steps = ['Discovery', 'Option', 'Negotiation', 'Casting', 'Job', 'Confirmed', 'Invoice'];

export function Lifecycle() {
  return (
    <div className="border-y border-line py-5" aria-label="From first look to locked date: discovery, option, negotiation, casting, job, confirmed, invoice">
      <Marquee pauseOnHover className="[--duration:38s] [--gap:3rem]" aria-hidden="true">
        {steps.map((t) => (
          <span key={t} className="flex items-center gap-12 text-xl font-medium tracking-tight md:text-2xl">
            {t}
            <span className="size-1.5 rounded-full bg-primary" />
          </span>
        ))}
      </Marquee>
    </div>
  );
}

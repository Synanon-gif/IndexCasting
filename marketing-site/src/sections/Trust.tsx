import { Heading } from '@/components/Heading';
import { BlurFade } from '@/components/ui/blur-fade';

const rows = [
  ['Everything on one platform', 'Casting, communication, calendar and billing in one system. Not five tabs.'],
  ['Agency control', 'Clients move faster without agencies losing the relationship or the thread.'],
  ['One spine', 'From discovery to booking, context stays intact across every handoff.'],
  ['GDPR-first', 'Scoped visibility, consent-aware flows and quiet control over what travels where.'],
  ['Built in Innsbruck', 'Engineering with European partners and operations in mind.'],
  ['Web + mobile', 'The same workflow on desktop and phone. Inbox, calendar and requests aligned.'],
] as const;

export function Trust() {
  return (
    <section id="trust" className="border-t border-line">
      <div className="mx-auto grid max-w-[1280px] gap-12 px-5 py-24 md:px-8 md:py-36 lg:grid-cols-[1fr_1.5fr] lg:gap-20">
        <div>
          <Heading text="Privacy in the architecture." className="text-[clamp(2.4rem,5vw,4.25rem)]" />
          <BlurFade inView delay={0.1}>
            <p className="mt-6 max-w-[38ch] text-lg leading-relaxed text-muted-foreground">
              A European baseline for cross-border casting, for partners who read the fine print and still want speed.
            </p>
          </BlurFade>
        </div>
        <dl>
          {rows.map(([t, d], i) => (
            <BlurFade key={t} inView delay={0.04 * i} offset={10} direction="up">
              <div className="grid gap-1 border-t border-line py-6 md:grid-cols-[minmax(0,15rem)_1fr] md:gap-10">
                <dt className="text-xl font-medium tracking-tight">{t}</dt>
                <dd className="text-[15px] leading-relaxed text-muted-foreground">{d}</dd>
              </div>
            </BlurFade>
          ))}
        </dl>
      </div>
    </section>
  );
}

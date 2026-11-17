import { Button } from '@/components/ui/button';
import { BorderBeam } from '@/components/ui/border-beam';
import Magnet from '@/components/Magnet';
import { Heading } from '@/components/Heading';
import { BlurFade } from '@/components/ui/blur-fade';
import { APP_ORIGIN, EARLY_ACCESS_EMAIL } from '@/constants';

export function Cta() {
  return (
    <section id="cta" className="bg-deep text-white">
      <div className="mx-auto max-w-[1280px] px-5 py-24 md:px-8 md:py-36">
        <Heading
          text="Casting finally gets a system."
          className="max-w-[16ch] text-[clamp(2.75rem,7vw,6rem)]"
        />
        <BlurFade inView delay={0.1}>
          <p className="mt-7 max-w-[44ch] text-lg leading-relaxed text-white/70">
            One workflow. Every stakeholder. From discovery to booking, without the chaos.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Magnet padding={50} magnetStrength={5}>
              <Button asChild size="lg" className="h-12 rounded-full bg-white px-7 text-[15px] text-deep hover:bg-white/90">
                <a href={`${APP_ORIGIN}/`} rel="noopener noreferrer">
                  Open Index Casting
                </a>
              </Button>
            </Magnet>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 rounded-full border-white/30 bg-transparent px-7 text-[15px] text-white hover:bg-white/10 hover:text-white"
            >
              <a href={`${APP_ORIGIN}/trust`} rel="noopener noreferrer">
                Trust &amp; security
              </a>
            </Button>
          </div>
        </BlurFade>

        <BlurFade inView delay={0.15}>
          <div className="relative mt-16 max-w-2xl overflow-hidden rounded-xl border border-white/15 p-6">
            <p className="text-[15px] leading-relaxed text-white/80">
              Currently onboarding selected agencies. Independent teams and small shops can test the product during
              rollout. For early access, write{' '}
              <a
                className="font-medium text-white underline underline-offset-4"
                href={`mailto:${EARLY_ACCESS_EMAIL}?subject=Index%20Casting%20—%20early%20access`}
              >
                {EARLY_ACCESS_EMAIL}
              </a>
              .
            </p>
            <BorderBeam size={120} duration={9} colorFrom="#8fd1b3" colorTo="#1a4a38" />
          </div>
        </BlurFade>
      </div>
    </section>
  );
}

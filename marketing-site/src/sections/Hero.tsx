import { Button } from '@/components/ui/button';
import { BlurFade } from '@/components/ui/blur-fade';
import Magnet from '@/components/Magnet';
import { Heading } from '@/components/Heading';
import { APP_ORIGIN, EARLY_ACCESS_EMAIL } from '@/constants';
import { HeroScene } from '@/scenes/HeroScene';

export function Hero() {
  return (
    <section id="top" className="mx-auto max-w-[1280px] px-5 pb-16 pt-10 md:px-8 md:pb-24 md:pt-16">
      <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
        <div>
          <Heading
            as="h1"
            trigger="load"
            delay={60}
            text="Fashion moves faster when everyone stays connected."
            className="text-[clamp(2.6rem,5.7vw,5.25rem)]"
          />
          <BlurFade delay={0.5} duration={0.8}>
            <p className="mt-7 max-w-[46ch] text-lg leading-relaxed text-muted-foreground">
              Visual discovery for clients. Operational clarity for agencies. A modern entry point into fashion for models.
            </p>
          </BlurFade>
          <BlurFade delay={0.65} duration={0.8}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Magnet padding={50} magnetStrength={5}>
                <Button asChild size="lg" className="h-12 rounded-full px-7 text-[15px]">
                  <a href={`${APP_ORIGIN}/`} rel="noopener noreferrer">
                    Open Index Casting
                  </a>
                </Button>
              </Magnet>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-7 text-[15px]">
                <a href={`mailto:${EARLY_ACCESS_EMAIL}?subject=Index%20Casting%20—%20early%20access`}>
                  Request early access
                </a>
              </Button>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Models stay connected through the agencies that represent them.
            </p>
          </BlurFade>
        </div>
        <HeroScene />
      </div>
    </section>
  );
}

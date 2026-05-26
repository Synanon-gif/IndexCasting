import { EyebrowRule } from '../components/EyebrowRule';
import { ProductShowcaseFrame } from '../components/ProductShowcaseFrame';
import { ProductVisual } from '../components/ProductVisual';
import { Reveal } from '../components/Reveal';
import { RevealTitle } from '../components/RevealTitle';
import { getScreenshotSlot } from '../screenshotSlots';
import { visual } from '../productVisuals';

const home = getScreenshotSlot('model-home-inbox')!;
const apply = getScreenshotSlot('model-apply')!;
const modelHero = visual('model-phones');

export function ModelSection() {
  return (
    <section id="models" className="section modelSection">
      <div className="shell modelLayout">
        <div className="modelCopyBlock">
          <EyebrowRule className="sectionEyebrow" textClass="accentWine">
            Models
          </EyebrowRule>
          <Reveal>
            <RevealTitle as="h2" className="sectionTitle modelTitle" lines={['The modern', 'entrance.']} />
          </Reveal>
          <Reveal delay={0.07}>
            <p className="sectionLead modelLead">
              Visibility with real agencies. Applications land where bookers work. Mobile-first access to inbox,
              calendars, and threads — one spine.
            </p>
          </Reveal>
        </div>

        <div className="modelHeroVisual">
          <ProductVisual
            src={modelHero.src}
            alt={modelHero.alt}
            width={modelHero.width}
            height={modelHero.height}
            className="modelHeroImage"
          />
        </div>

        <div className="modelSlotsRow">
          <ProductShowcaseFrame slotId={home.id} label={home.label} variant="wine" aspect="phone" />
          <ProductShowcaseFrame slotId={apply.id} label={apply.label} variant="porcelain" aspect="phone" />
        </div>

        <div className="modelStrip">
          {[
            'Seen by working bookers',
            'Recruiting · apply paths',
            'Agency chat · connected',
            'Pocket parity with the desk',
          ].map((t, i) => (
            <Reveal key={t} delay={0.06 + i * 0.075}>
              <div className="modelCard">
                <p>{t}</p>
              </div>
            </Reveal>
          ))}
        </div>

      </div>
    </section>
  );
}

import { EyebrowRule } from '../components/EyebrowRule';
import { ProductShowcaseFrame } from '../components/ProductShowcaseFrame';
import { Reveal } from '../components/Reveal';
import { RevealTitle } from '../components/RevealTitle';
import { getScreenshotSlot } from '../screenshotSlots';

const home = getScreenshotSlot('model-home-inbox')!;
const apply = getScreenshotSlot('model-apply')!;

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

        <div className="modelSlotsRow">
          <ProductShowcaseFrame
            slotId={home.id}
            label={home.label}
            caption={home.purpose}
            variant="wine"
            aspect="phone"
          />
          <ProductShowcaseFrame
            slotId={apply.id}
            label={apply.label}
            caption={apply.purpose}
            variant="porcelain"
            aspect="phone"
          />
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

        <p className="slotsSectionNote slotsNoteLabel">Model · reserved captures</p>
        <p className="modelQuietNote">
          Calendar, availability, and agency chat ship as additional frames when product captures are ready.
        </p>
      </div>
    </section>
  );
}

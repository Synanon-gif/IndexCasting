import { EyebrowRule } from '../components/EyebrowRule';
import { ProductShot } from '../components/ProductShot';
import { Reveal } from '../components/Reveal';
import { RevealTitle } from '../components/RevealTitle';
import { visual } from '../productVisuals';

const modelHero = visual('model-phones');
const modelInbox = visual('model-phone-inbox');
const modelRequest = visual('model-phone-request');

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

        <ProductShot
          src={modelHero.src}
          alt={modelHero.alt}
          width={modelHero.width}
          height={modelHero.height}
          wide
          className="modelHeroShot"
        />

        <div className="modelPhoneRow">
          <ProductShot
            src={modelInbox.src}
            alt={modelInbox.alt}
            width={modelInbox.width}
            height={modelInbox.height}
          />
          <ProductShot
            src={modelRequest.src}
            alt={modelRequest.alt}
            width={modelRequest.width}
            height={modelRequest.height}
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
      </div>
    </section>
  );
}

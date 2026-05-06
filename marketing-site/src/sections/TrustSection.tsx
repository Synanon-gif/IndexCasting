import { EyebrowRule } from '../components/EyebrowRule';
import { ProductShowcaseFrame } from '../components/ProductShowcaseFrame';
import { Reveal } from '../components/Reveal';
import { RevealTitle } from '../components/RevealTitle';
import { getScreenshotSlot } from '../screenshotSlots';

const trustVis = getScreenshotSlot('trust-visibility')!;

export function TrustSection() {
  return (
    <section id="trust" className="section trustSection">
      <div className="shell trustInner">
        <EyebrowRule className="sectionEyebrow" textClass="accentOlive">
          Trust · baseline
        </EyebrowRule>
        <Reveal>
          <RevealTitle as="h2" className="sectionTitle trustTitle" lines={['Privacy in the', 'architecture.']} />
        </Reveal>
        <div className="trustGrid">
          <Reveal delay={0.06}>
            <article className="trustCard">
              <h3>Built in Germany</h3>
              <p>Engineering with the restraint operations expect — not a side project on a spreadsheet.</p>
            </article>
          </Reveal>
          <Reveal delay={0.11}>
            <article className="trustCard">
              <h3>GDPR-first</h3>
              <p>Scoped visibility, consent-aware flows, and quiet control over what travels where.</p>
            </article>
          </Reveal>
          <Reveal delay={0.16}>
            <article className="trustCard">
              <h3>Professional visibility</h3>
              <p>Agency, client, and model surfaces stay in their lanes — without slowing the people inside them.</p>
            </article>
          </Reveal>
        </div>
        <div className="trustShowcaseWrap">
          <ProductShowcaseFrame
            slotId={trustVis.id}
            label={trustVis.label}
            caption={trustVis.purpose}
            variant="noir"
            aspect="wide"
          />
          <p className="slotsSectionNote slotsNoteLabel trustSlotsNote">Trust · planned capture</p>
        </div>
        <Reveal delay={0.1}>
          <p className="trustFoot">
            A European baseline for cross-border casting — for partners who read the fine print and still want speed.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

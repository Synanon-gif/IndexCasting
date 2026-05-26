import { EyebrowRule } from '../components/EyebrowRule';
import { ProblemWorkflowCollage } from '../components/ProblemWorkflowCollage';
import { ProductVisual } from '../components/ProductVisual';
import { Reveal } from '../components/Reveal';
import { RevealTitle } from '../components/RevealTitle';
import { visual } from '../productVisuals';

const chaos = [
  { t: 'Inboxes', d: 'noise eats the decision' },
  { t: 'Sheets', d: 'versions never meet' },
  { t: 'PDF packs', d: 'frozen when sent' },
  { t: 'Parallel chats', d: 'no spine at handoff' },
  { t: 'Ad-hoc diaries', d: 'option vs job — blurred' },
  { t: 'Tool sprawl', d: 'everyone out of phase' },
];

const platformVisual = visual('platform-connected');

export function ProblemSection() {
  return (
    <section id="problem" className="section problemSection">
      <div className="shell">
        <div className="problemIntro">
          <div className="problemIntroCopy">
            <EyebrowRule className="sectionEyebrow">The friction</EyebrowRule>
            <Reveal>
              <RevealTitle as="h2" className="sectionTitle problemTitle" lines={['Still too many', 'surfaces.']} />
            </Reveal>
            <Reveal delay={0.06}>
              <p className="sectionLead problemLead">
                The set is decisive. The ops layer rarely is. Context splits — momentum leaks.
              </p>
            </Reveal>
          </div>
          <Reveal delay={0.08}>
            <ProblemWorkflowCollage />
          </Reveal>
        </div>

        <div className="problemGrid">
          {chaos.map((item, i) => (
            <Reveal key={item.t} delay={i * 0.09}>
              <article className="problemCard">
                <h3>{item.t}</h3>
                <p>{item.d}</p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.12}>
          <div className="problemBridge">
            <div className="problemBridgeCopy">
              <p className="problemBridgeLabel">One workflow</p>
              <p className="problemBridgeText">
                Index holds one spine from first look to locked date — calendar, messaging, and billing connected.
              </p>
            </div>
            <div className="problemBridgeVisual">
              <ProductVisual
                src={platformVisual.src}
                alt={platformVisual.alt}
                width={platformVisual.width}
                height={platformVisual.height}
                className="problemBridgeImage"
              />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

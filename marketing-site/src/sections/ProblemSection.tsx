import { EyebrowRule } from '../components/EyebrowRule';
import { Reveal } from '../components/Reveal';
import { RevealTitle } from '../components/RevealTitle';

const chaos = [
  { t: 'Inboxes', d: 'noise eats the decision' },
  { t: 'Sheets', d: 'versions never meet' },
  { t: 'PDF packs', d: 'frozen when sent' },
  { t: 'Parallel chats', d: 'no spine at handoff' },
  { t: 'Ad-hoc diaries', d: 'option vs job — blurred' },
  { t: 'Tool sprawl', d: 'everyone out of phase' },
];

export function ProblemSection() {
  return (
    <section id="problem" className="section problemSection">
      <div className="shell">
        <EyebrowRule className="sectionEyebrow">The friction</EyebrowRule>
        <Reveal>
          <RevealTitle as="h2" className="sectionTitle problemTitle" lines={['Still too many', 'surfaces.']} />
        </Reveal>
        <Reveal delay={0.06}>
          <p className="sectionLead problemLead">
            The set is decisive. The ops layer rarely is. Context splits — momentum leaks.
          </p>
        </Reveal>

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
            <p className="problemBridgeLabel">The turn</p>
            <p className="problemBridgeText">
              Index holds one spine from first look to locked date — legible coordination, overhead that stops
              compounding.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

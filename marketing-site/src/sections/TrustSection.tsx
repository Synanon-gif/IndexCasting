import { EyebrowRule } from '../components/EyebrowRule';
import { Reveal } from '../components/Reveal';
import { RevealTitle } from '../components/RevealTitle';

const uspCards = [
  {
    n: '01',
    title: 'Everything on one platform',
    body: 'Casting, communication, calendar, and billing in one system — not five tabs.',
  },
  {
    n: '02',
    title: 'Agency control',
    body: 'Clients move faster without agencies losing the relationship or the thread.',
  },
  {
    n: '03',
    title: 'One spine',
    body: 'From discovery to booking, context stays intact across every handoff.',
  },
  {
    n: '04',
    title: 'Built in Innsbruck',
    body: 'GDPR-first engineering with European partners and operations in mind.',
  },
  {
    n: '05',
    title: 'Web + mobile',
    body: 'The same workflow on desktop and phone — inbox, calendar, and requests aligned.',
  },
];

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

        <div className="uspGrid">
          {uspCards.map((card, i) => (
            <Reveal key={card.n} delay={0.04 + i * 0.05}>
              <article className="uspCard">
                <span className="uspCardNum">{card.n}</span>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            </Reveal>
          ))}
        </div>

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
        <Reveal delay={0.08}>
          <p className="trustFoot">
            A European baseline for cross-border casting — for partners who read the fine print and still want speed.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

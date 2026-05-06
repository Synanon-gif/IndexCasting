import { SiteFooter } from './components/SiteFooter';
import { SiteNav } from './components/SiteNav';
import { AgencySection } from './sections/AgencySection';
import { ClientSection } from './sections/ClientSection';
import { FinalCtaSection } from './sections/FinalCtaSection';
import { HeroSection } from './sections/HeroSection';
import { ModelSection } from './sections/ModelSection';
import { ProblemSection } from './sections/ProblemSection';
import { TrustSection } from './sections/TrustSection';

export function App() {
  return (
    <div className="page">
      <a href="#main-content" className="skipLink">
        Skip to main content
      </a>
      <SiteNav />
      <main id="main-content" tabIndex={-1}>
        <HeroSection />
        <ProblemSection />
        <AgencySection />
        <ClientSection />
        <ModelSection />
        <TrustSection />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}

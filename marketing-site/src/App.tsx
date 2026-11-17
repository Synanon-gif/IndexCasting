import { Footer } from '@/components/Footer';
import { Nav } from '@/components/Nav';
import { Audience } from '@/sections/Audience';
import { Cta } from '@/sections/Cta';
import { Hero } from '@/sections/Hero';
import { Lifecycle } from '@/sections/Lifecycle';
import { Problem } from '@/sections/Problem';
import { Trust } from '@/sections/Trust';

export function App() {
  return (
    <div>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2 focus:text-background"
      >
        Skip to main content
      </a>
      <Nav />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <Lifecycle />
        <Problem />
        <Audience />
        <Trust />
        <Cta />
      </main>
      <Footer />
    </div>
  );
}

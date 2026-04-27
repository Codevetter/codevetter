import { Nav } from "@/components/molecules/Nav";
import { Footer } from "@/components/molecules/Footer";
import { Hero } from "@/components/organisms/Hero";
import { Stats } from "@/components/organisms/Stats";
import { CatchStrip } from "@/components/organisms/CatchStrip";
import { Bento } from "@/components/organisms/Bento";
import { HowItWorks } from "@/components/organisms/HowItWorks";
import { Providers } from "@/components/organisms/Providers";
import { Pricing } from "@/components/organisms/Pricing";
import { CTA } from "@/components/organisms/CTA";
import { ScrollProgress } from "@/components/effects/ScrollProgress";

export default function Page() {
  return (
    <main>
      <Nav />
      <ScrollProgress />
      <Hero />
      <CatchStrip />
      <Stats />
      <Bento />
      <HowItWorks />
      <Providers />
      <Pricing />
      <CTA />
      <Footer />
    </main>
  );
}

import { ScrollProgress } from "@/components/effects/ScrollProgress";
import { Footer } from "@/components/molecules/Footer";
import { Nav } from "@/components/molecules/Nav";
import { Bento } from "@/components/organisms/Bento";
import { CatchStrip } from "@/components/organisms/CatchStrip";
import { CTA } from "@/components/organisms/CTA";
import { Hero } from "@/components/organisms/Hero";
import { HowItWorks } from "@/components/organisms/HowItWorks";
import { Pricing } from "@/components/organisms/Pricing";
import { Providers } from "@/components/organisms/Providers";
import { Stats } from "@/components/organisms/Stats";

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

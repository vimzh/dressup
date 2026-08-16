import { EdgeGlow } from "@/components/site/edge-glow";
import { Features } from "@/components/site/features";
import { Footer } from "@/components/site/footer";
import { Hero } from "@/components/site/hero";
import { HowItWorks } from "@/components/site/how-it-works";
import { Retailers } from "@/components/site/retailers";
import { Sequence } from "@/components/site/sequence";
import { TopBanner } from "@/components/site/top-banner";
import { resolveShots } from "@/lib/shots";

export default function Home() {
  const shots = resolveShots();

  return (
    <>
      <EdgeGlow />
      <TopBanner />
      <main>
        <Hero shots={shots} />
        <Retailers />
        <Sequence shots={shots} />
        <Features shots={shots} />
        <HowItWorks />
        <Footer />
      </main>
    </>
  );
}

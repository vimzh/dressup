import { EdgeGlow } from "@/components/site/edge-glow";
import { ExpertOpinion } from "@/components/site/expert-opinion";
import { Features } from "@/components/site/features";
import { Footer } from "@/components/site/footer";
import { Hero } from "@/components/site/hero";
import { HowItWorks } from "@/components/site/how-it-works";
import { Retailers } from "@/components/site/retailers";
import { Sequence } from "@/components/site/sequence";
import { TopBanner } from "@/components/site/top-banner";
import { resolveShots } from "@/lib/shots";
import Image from "next/image";

export default function Home() {
  const shots = resolveShots();

  return (
    <>
      <EdgeGlow />
      <TopBanner />
      <main>
        <Hero shots={shots} />
        <Retailers />
        <section className="px-6 py-16 sm:py-20" aria-label="Zdress journey">
          <div className="mx-auto max-w-6xl">
            <Image
              alt="Browse fashion, see the outfit on you, and save the look with its source products"
              className="w-full rounded-xs border border-white/10"
              height={852}
              sizes="(max-width: 768px) 100vw, 1152px"
              src="/brand/zdress-journey.webp"
              width={1800}
            />
            <p className="mt-4 text-center font-mono text-[11px] text-white/40 uppercase tracking-[0.22em]">
              Browse · Try on · Save with source links
            </p>
          </div>
        </section>
        <Sequence shots={shots} />
        <Features shots={shots} />
        <ExpertOpinion shots={shots} />
        <HowItWorks />
        <Footer />
      </main>
    </>
  );
}

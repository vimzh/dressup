import { Reveal } from "@/components/site/reveal";
import { Shot } from "@/components/site/shot";
import type { ResolvedShots } from "@/lib/shots-meta";

export function ExpertOpinion({ shots }: { shots: ResolvedShots }) {
  return (
    <section className="px-6 py-24 sm:py-32" id="expert-opinion">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
        <Reveal>
          <p className="mb-4 font-mono text-[11px] text-glow/70 uppercase tracking-[0.22em]">
            AI fashion expert
          </p>
          <h2 className="display-section text-balance text-[clamp(2.25rem,5vw,4rem)] text-white">
            The try-on shows it. The expert explains it.
          </h2>
          <p className="mt-5 max-w-lg text-[15px] text-white/70 leading-relaxed">
            The expert reads the generated try-on—not the catalogue model—and
            explains the silhouette, proportions and colour pairings that work.
          </p>
          <ul className="mt-8 grid gap-3 text-sm text-white/60">
            <li className="border-l border-glow/45 pl-4">
              Concrete fit and styling feedback
            </li>
            <li className="border-l border-white/15 pl-4">
              Useful colour pairings and next-step suggestions
            </li>
            <li className="border-l border-white/15 pl-4">
              Follow-up questions in the same conversation
            </li>
          </ul>
          <p className="mt-7 font-mono text-[10px] text-white/35 uppercase tracking-[0.16em]">
            Actual extension UI · sample analysis
          </p>
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2">
          <Shot name="expertContext" src={shots.expertContext} />
          <Shot name="expertOpinion" src={shots.expertOpinion} />
        </div>
      </div>
    </section>
  );
}

import { Reveal } from "@/components/site/reveal";
import { Shot } from "@/components/site/shot";
import type { ResolvedShots } from "@/lib/shots-meta";

const STAGES = [
  {
    body: "The control lives on each product card — no links, uploads or tab switching.",
    shot: "gridBefore",
    title: "Every card, its own button",
  },
  {
    body: "Try several products at once; every card renders independently.",
    shot: "gridParallel",
    title: "Click as many as you like",
  },
  {
    body: "Results replace catalogue photos in place, with save, opinion and revert controls.",
    shot: "gridAfter",
    title: "The grid becomes a grid of you",
  },
] as const;

export function Sequence({ shots }: { shots: ResolvedShots }) {
  return (
    <section className="relative px-6 py-24 sm:py-32" id="in-the-grid">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="mb-4 font-mono text-[11px] text-glow/70 uppercase tracking-[0.22em]">
            In the grid
          </p>
        </Reveal>
        <Reveal delay={0.06}>
          <h2 className="display-section max-w-3xl text-balance text-[clamp(2.25rem,6vw,4.25rem)] text-white">
            One click each. They render in parallel.
          </h2>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="mt-6 max-w-2xl text-[15px] text-white/50 leading-relaxed">
            Click several products and keep browsing while each try-on renders
            independently.
          </p>
        </Reveal>

        <div className="mt-16 space-y-16 sm:space-y-20">
          {STAGES.map((stage, i) => (
            <Reveal delay={0.04} key={stage.title}>
              <div>
                <div className="mb-5 flex items-baseline gap-4">
                  <span className="font-mono text-[11px] text-glow/70 tabular-nums tracking-[0.2em]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="display-section text-xl text-white sm:text-2xl">
                      {stage.title}
                    </h3>
                    <p className="mt-2 max-w-xl text-[14px] text-white/50 leading-relaxed">
                      {stage.body}
                    </p>
                  </div>
                </div>
                <Shot
                  name={stage.shot}
                  src={shots[stage.shot]}
                />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

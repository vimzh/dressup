import { FeatureCard } from "@/components/site/feature-card";
import { Reveal } from "@/components/site/reveal";
import { Shot } from "@/components/site/shot";
import type { ResolvedShots } from "@/lib/shots-meta";

export function Features({ shots }: { shots: ResolvedShots }) {
  return (
    <section className="relative px-6 py-24 sm:py-32" id="features">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="mb-4 font-mono text-[11px] text-glow/70 uppercase tracking-[0.22em]">
            What it does
          </p>
        </Reveal>
        <Reveal delay={0.06}>
          <h2 className="display-section max-w-3xl text-balance text-[clamp(2.25rem,6vw,4.25rem)] text-white">
            No app to exit. No link to paste.
          </h2>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="mt-4 max-w-2xl text-[15px] text-white/70 leading-relaxed">
            Zdress stays inside the store: upload once, try products in place,
            combine pieces across sites, and keep or discuss the results.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            className="lg:col-span-2"
            index={0}
            media={
              <Shot frame="max-w-[300px]" name="cardButton" src={shots.cardButton} />
            }
            title="The card's photo becomes you"
          >
            <p>
              The control lives on each product card. Click it and the catalogue
              photo becomes your try-on, with save, opinion and revert still in
              place.
            </p>
          </FeatureCard>

          <FeatureCard
            index={1}
            media={<Shot name="uploadOnce" src={shots.uploadOnce} />}
            title="Upload once. Then it's one click."
          >
            <p>
              Your photo is screened once, then reused for every product. Bad
              crops are caught before they spoil a full browsing session.
            </p>
          </FeatureCard>

          <FeatureCard
            index={2}
            media={<Shot name="fitPanel" src={shots.fitPanel} />}
            title="A whole fit, across stores"
          >
            <p>
              Select a top on one store and trousers on another, then render
              both as one outfit from the extension.
            </p>
          </FeatureCard>

          <FeatureCard
            index={3}
            media={
              <Shot frame="max-w-[240px]" name="fitResult" src={shots.fitResult} />
            }
            title="Layering with rules, not luck"
          >
            <p>
              Fits apply lower body, then upper, then shoes. Conflicting pieces
              are dropped with a clear reason instead of producing a broken
              look.
            </p>
          </FeatureCard>

          <FeatureCard
            index={4}
            media={<Shot name="sourceIntegrity" src={shots.sourceIntegrity} />}
            title="Nothing is invented"
          >
            <p>
              Pinterest garments are cut from the source and composed as shown.
              Zdress never invents missing pieces, logos or fabric details.
            </p>
          </FeatureCard>

          <FeatureCard
            className="lg:col-span-3"
            index={5}
            media={<Shot name="expertOpinion" src={shots.expertOpinion} />}
            title="Then the question a try-on can't answer"
          >
            <p>
              Every result includes a concise read on silhouette, proportion
              and useful colours, then accepts a follow-up question.
            </p>
          </FeatureCard>

          <FeatureCard
            className="lg:col-span-3"
            index={6}
            media={
              <div className="mx-auto grid max-w-2xl grid-cols-2 items-start gap-3">
                <Shot name="collections" src={shots.collections} />
                <Shot name="collectionsDetail" src={shots.collectionsDetail} />
              </div>
            }
            title="Saved looks, not dead links"
          >
            <p>
              Save renders into collections and reopen each product listing
              anytime. The files remain after YouCam&apos;s temporary links expire.
            </p>
          </FeatureCard>
        </div>
      </div>
    </section>
  );
}

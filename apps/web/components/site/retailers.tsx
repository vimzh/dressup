import { Reveal } from "@/components/site/reveal";

const SITES = [
  "Myntra",
  "AJIO",
  "Flipkart",
  "Amazon",
  "Nykaa Fashion",
  "SNITCH",
  "Bewakoof",
  "Max Fashion",
  "Libas",
  "Tata CLiQ",
  "Etsy",
  "ASOS",
  "H&M",
  "Zalando",
  "Abercrombie",
  "Hollister",
  "Pinterest",
];

export function Retailers() {
  return (
    <section className="relative py-10">
      <Reveal>
        <p className="mb-7 text-center font-mono text-[11px] text-white/30 uppercase tracking-[0.22em]">
          Works on sixteen retailers and Pinterest
        </p>
      </Reveal>

      <div className="marquee-mask overflow-hidden">
        <div className="marquee-track flex items-center gap-10 pr-10">
          {[...SITES, ...SITES].map((site, i) => (
            <span
              className="shrink-0 whitespace-nowrap font-display text-lg text-white/35 transition-colors duration-300 hover:text-white/80"
              key={`${site}-${i}`}
              style={{ fontVariationSettings: '"wght" 600, "wdth" 88' }}
            >
              {site}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The page's only light source: a single hue bleeding in from all four edges
 * and dissipating to nothing at the centre. Fixed, so it frames the viewport
 * rather than scrolling away with the hero.
 */
export function EdgeGlow() {
  return (
    <div
      aria-hidden="true"
      className="grain pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="edge-glow glow-breathe absolute -inset-24" />
    </div>
  );
}

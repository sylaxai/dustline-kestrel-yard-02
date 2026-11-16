// The look plan, in one place. A dusk industrial yard: cold slate and concrete, warm
// amber site lights, one hot accent for the enemy team and the bomb. The same names are
// the CSS custom properties in index.html, so the HUD and the 3D scene share a palette.
export const PALETTE = {
  canvas: '#252c3a', // sky / fog — deep blue dusk, readable against the skyline
  surface: '#2a2f38', // concrete
  hairline: '#3a4150', // steel trim
  ink: '#e8e4d8', // chalk / markings
  muted: '#8b95a5', // distant steel
  accent: '#f0a830', // amber: sites, bomb, highlights
  danger: '#e5484d', // enemy team, damage
  ally: '#3fb97f', // friendly team
  sand: '#b09a6a', // dry ground patches
};

export function shade(name) {
  return PALETTE[name];
}

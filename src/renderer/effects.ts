// Plain-language names and descriptions for QMK RGB matrix effects, grouped by what they look like.

export type EffectGroup = "steady" | "rainbow" | "motion" | "sparkle" | "typing" | "more";

export interface EffectInfo {
  title: string;
  description: string;
  group: EffectGroup;
  /** Uses the colour picked in the app (otherwise it makes its own colours). */
  usesColour: boolean;
}

export const EFFECT_GROUPS: { id: EffectGroup; title: string; subtitle: string }[] = [
  { id: "steady", title: "Steady", subtitle: "Calm, single colour" },
  { id: "rainbow", title: "Rainbow", subtitle: "The whole spectrum, always moving" },
  { id: "motion", title: "Motion", subtitle: "Beams, rings and spirals" },
  { id: "sparkle", title: "Sparkle", subtitle: "Random keys light up" },
  { id: "typing", title: "Reacts to typing", subtitle: "Comes alive as you type" },
  { id: "more", title: "More effects", subtitle: "" },
];

const KNOWN: [RegExp, EffectInfo][] = [
  [/^solid color$/i, { title: "Solid", description: "One steady colour on every key.", group: "steady", usesColour: true }],
  [/^breathing$/i, { title: "Breathing", description: "Your colour slowly fades in and out.", group: "steady", usesColour: true }],
  [/band spiral val/i, { title: "Lighthouse", description: "A bright beam sweeps around the keyboard.", group: "motion", usesColour: true }],
  [/band.*val/i, { title: "Light band", description: "A bright band slides across the keys.", group: "motion", usesColour: true }],
  [/band.*sat/i, { title: "White band", description: "A pale band slides across your colour.", group: "motion", usesColour: true }],
  [/^cycle all$/i, { title: "Colour cycle", description: "Every key shifts through the rainbow together.", group: "rainbow", usesColour: false }],
  [/cycle left right/i, { title: "Rainbow wave", description: "A rainbow scrolls from left to right.", group: "rainbow", usesColour: false }],
  [/cycle up down/i, { title: "Rainbow rise", description: "Rainbow stripes move from top to bottom.", group: "rainbow", usesColour: false }],
  [/chevron/i, { title: "Chevron", description: "Rainbow arrows march across the keys.", group: "rainbow", usesColour: false }],
  [/cycle out in dual/i, { title: "Twin ripples", description: "Rainbow rings flow from each half of the board.", group: "motion", usesColour: false }],
  [/cycle out in/i, { title: "Ripple", description: "Rainbow rings flow out from the centre.", group: "motion", usesColour: false }],
  [/pinwheel/i, { title: "Pinwheel", description: "A rainbow wheel spins around the centre.", group: "motion", usesColour: false }],
  [/cycle spiral/i, { title: "Spiral", description: "A rainbow spiral twists outward.", group: "motion", usesColour: false }],
  [/dual beacon/i, { title: "Dual beacon", description: "Two shades of your colour rotate around the centre.", group: "motion", usesColour: true }],
  [/rainbow beacon/i, { title: "Rainbow beacon", description: "A rotating rainbow beam.", group: "rainbow", usesColour: false }],
  [/jellybean|raindrop/i, { title: "Jellybeans", description: "Keys pop on in random colours.", group: "sparkle", usesColour: false }],
  [/pixel rain/i, { title: "Pixel rain", description: "Random keys flicker on and off in random colours.", group: "sparkle", usesColour: false }],
  [/digital rain/i, { title: "Digital rain", description: "Green streams fall down the keys, Matrix style.", group: "sparkle", usesColour: false }],
  [/heatmap/i, { title: "Typing heatmap", description: "Keys you use most glow red; idle keys cool to green and off.", group: "typing", usesColour: false }],
  [/reactive simple/i, { title: "Key glow", description: "Each key lights up as you press it, then fades.", group: "typing", usesColour: true }],
  [/multiwide|reactive wide/i, { title: "Shockwave", description: "A burst of light spreads from every key you press.", group: "typing", usesColour: true }],
  [/nexus|cross/i, { title: "Crosshair", description: "Light shoots along the row and column of each key you press.", group: "typing", usesColour: true }],
  [/^solid splash$/i, { title: "Colour splash", description: "Pressing a key sends out rings in your colour.", group: "typing", usesColour: true }],
  [/splash/i, { title: "Rainbow splash", description: "Pressing a key sends out rainbow rings.", group: "typing", usesColour: false }],
  [/gradient/i, { title: "Gradient", description: "A soft blend of colours across the board.", group: "steady", usesColour: true }],
];

export function effectInfo(name: string): EffectInfo {
  return KNOWN.find(([re]) => re.test(name))?.[1] ?? { title: name, description: "An effect built into this keyboard.", group: "more", usesColour: true };
}

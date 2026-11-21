// The Tool Length Setter panel's strings. This edition has no translations.
const TEXT: Record<string, string> = {
  "touching": "Touch",
  "zeroSet": "{what} zero set",
  "sets": "sets {what}",
  "pictureLabel": "The tool length setter on the material, and the moves the routine makes",
  "ready": "Setter ready",
  "steps.fast": "Go down until the setter triggers",
  "steps.lift": "Lift off and wait a moment",
  "steps.slow": "Touch again, slowly",
  "steps.park": "Lift clear of the setter",
  "about": "The setter's plunger gives a little under the bit. The slow second touch is the one that sets Z, by the setter's height.",
  "start.title": "Put the bit above the middle of the setter.",
  "start.text": "The setter stands on the surface you want as Z zero.",
};

export const useToolSetterText = () =>
  (key: string, params: Record<string, unknown> = {}) =>
    (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));

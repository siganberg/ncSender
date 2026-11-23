// The 3D Probe panel's strings. This edition has no translations.
const TEXT: Record<string, string> = {
  "pictureLabel": "The 3D probe and the moves the routine makes",
  "measured": "{what} measured",
  "finds": "finds {what}",
  "findCenter": "Find the center of",
  "inner": "Hole",
  "outer": "Part",
  "whereCorner": "Corner to probe",
  "whereSide": "Side to probe",
  "tapCorner": "Tap a corner of the board to choose it.",
  "tapSide": "Tap a side of the board to choose it.",
  "steps.top": "Touch the top of the material",
  "steps.sideX": "Go down beside the material and touch its side",
  "steps.sideY": "Go round and touch the other side",
  "steps.lift": "Lift and move over the corner",
  "steps.sideOnly": "Touch the side of the material",
  "steps.wallsX": "Touch the hole's walls, left and right",
  "steps.wallsY": "Touch the hole's walls, front and back",
  "steps.liftOut": "Lift out over the center",
  "steps.sidesX": "Go down and touch the part's sides, left and right",
  "steps.sidesY": "Go down and touch the part's sides, front and back",
  "start.z": "Put the probe above the material.",
  "start.side": "Put the probe's tip beside the material, below its top.",
  "start.xy": "Put the probe's tip just outside the corner, below the top.",
  "start.xyz": "Put the probe above the material, near the corner.",
  "start.inner": "Put the probe above the middle of the hole.",
  "start.outer": "Put the probe above the middle of the part.",
  "start.outerZ": "Put the probe above the middle of the part, close to its top.",
  "end.z": "Stops just above the surface.",
  "end.side": "Backs off a little when done.",
  "end.corner": "Stops over X0 Y0, above the material.",
  "end.inner": "Stops over the center, lifted out of the hole. Works on square and round holes.",
  "end.outer": "Stops over the center of the part. Works on square and round parts.",
};

export const useProbe3dText = () =>
  (key: string, params: Record<string, unknown> = {}) =>
    (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));

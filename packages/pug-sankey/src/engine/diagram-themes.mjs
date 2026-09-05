// Shared by the Pug parser and settings UI. Themes change routing, not data,
// quantity scales, endpoint styles, or the editor's light/dark appearance.
export const DIAGRAM_THEMES = Object.freeze([
  Object.freeze({ id: "smooth", label: "Smooth", description: "Quiet, continuous curves. The original solid-ribbon style." }),
  Object.freeze({ id: "wiggly", label: "Wiggly", description: "Broad, flowing waves that settle smoothly into each junction." }),
  Object.freeze({ id: "angular", label: "Angular", description: "Straight runs with crisp diagonal turns." }),
  Object.freeze({ id: "terraced", label: "Terraced", description: "Two rounded transitions with a level stretch between them." }),
  Object.freeze({ id: "arc", label: "Arc", description: "Sweeping, raised arches between the junctions." }),
  Object.freeze({ id: "ripple", label: "Ripple", description: "A repeated, shallow ripple along each ribbon." }),
  Object.freeze({ id: "circuit", label: "Circuit", description: "Orthogonal runs with rounded right-angle elbows." }),
  Object.freeze({ id: "zigzag", label: "Zigzag", description: "Faceted, alternating bends with flat entrances and exits." }),
  Object.freeze({ id: "staircase", label: "Staircase", description: "Three crisp steps between the source and destination." }),
  Object.freeze({ id: "sail", label: "Sail", description: "An early, asymmetric crest followed by a long settling curve." }),
  Object.freeze({ id: "dip", label: "Dip", description: "Deep, rounded bowls that rise back into each junction." }),
  Object.freeze({ id: "s-bend", label: "S-bend", description: "Long, calm entrances with a concentrated S-shaped transition." }),
]);
export const DEFAULT_DIAGRAM_THEME = "smooth";
export const isDiagramTheme = value => DIAGRAM_THEMES.some(theme => theme.id === value);

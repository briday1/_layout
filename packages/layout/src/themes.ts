import type { Theme, ThemeTokens } from './types.js';

export function extendTheme(
  base: Theme,
  overrides: Pick<Theme, 'id' | 'label'> & {
    colorScheme?: Theme['colorScheme'];
    tokens?: Partial<ThemeTokens>;
  },
): Theme {
  return Object.freeze({
    ...base, ...overrides,
    tokens: Object.freeze({ ...base.tokens, ...overrides.tokens }),
  });
}

// Principal palettes mapped from fountain-publisher's styles.css at
// b8e2330f95062470590413c6511552ff2d1e06ed. Publication styling stays in adapters.
const light: Theme = Object.freeze({
  id: 'light', label: 'Light', colorScheme: 'light',
  tokens: Object.freeze({
    background: '#c8cbcd', surface: '#e7e8e8', surfaceRaised: '#eeeeed',
    text: '#1f2225', muted: '#6d7277', border: '#d1d3d4',
    accent: '#366fc2', accentText: '#ffffff', selection: '#e6effc', danger: '#c43f3f',
    preview: '#ffffff', previewText: '#101010',
    font: 'Inter, ui-sans-serif, system-ui, sans-serif',
    editorFont: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  }),
});
const dark = extendTheme(light, {
  id: 'dark', label: 'Dark', colorScheme: 'dark',
  tokens: {
    background: '#17191b', surface: '#202326', surfaceRaised: '#282b2f',
    text: '#eceeef', muted: '#a6abb0', border: '#3a3e42',
    accent: '#75a8ed', accentText: '#111315', selection: '#263c59', danger: '#f08080',
    preview: '#17191b', previewText: '#f1f1ef',
  },
});

export const builtinThemes: Theme[] = [
  light, dark,
  extendTheme(light, {
    id: 'solarized-light', label: 'Solarized Light',
    tokens: {
      background: '#d2c9b1', surface: '#eee8d5', surfaceRaised: '#fdf6e3',
      text: '#073642', muted: '#657b83', border: '#d2c9b1',
      accent: '#268bd2', selection: '#dce8e5', preview: '#fdf6e3', previewText: '#073642',
    },
  }),
  extendTheme(dark, {
    id: 'solarized-dark', label: 'Solarized Dark',
    tokens: {
      background: '#002b36', surface: '#073642', surfaceRaised: '#0b414e',
      text: '#fdf6e3', muted: '#93a1a1', border: '#28515a',
      accent: '#2aa198', selection: '#164f51', preview: '#002b36', previewText: '#fdf6e3',
    },
  }),
  extendTheme(dark, {
    id: 'espresso', label: 'Espresso',
    tokens: {
      background: '#211b18', surface: '#3c312c', surfaceRaised: '#473a33',
      text: '#fff1df', muted: '#c5b4a3', border: '#59483e',
      accent: '#d9a66f', selection: '#574330', preview: '#2d2522', previewText: '#fff1df',
    },
  }),
  extendTheme(dark, {
    id: 'dracula', label: 'Dracula',
    tokens: {
      background: '#191a21', surface: '#21222c', surfaceRaised: '#282a36',
      text: '#f8f8f2', muted: '#a6abcb', border: '#44475a',
      accent: '#bd93f9', selection: '#44405e', preview: '#282a36', previewText: '#f8f8f2',
    },
  }),
  extendTheme(dark, {
    id: 'tokyo-night', label: 'Tokyo Night',
    tokens: {
      background: '#101117', surface: '#16161e', surfaceRaised: '#1a1b26',
      text: '#c0caf5', muted: '#9aa5ce', border: '#363b54',
      accent: '#7aa2f7', selection: '#283457', preview: '#1a1b26', previewText: '#c0caf5',
    },
  }),
  extendTheme(dark, {
    id: 'synth-wave', label: 'Synth Wave',
    tokens: {
      background: '#1b1426', surface: '#2b213a', surfaceRaised: '#342647',
      text: '#fff3ff', muted: '#d0b3d9', border: '#594069',
      accent: '#ff7edb', selection: '#623354', preview: '#241b2f', previewText: '#fff3ff',
    },
  }),
];

/** Scoped tokens allow multiple differently themed workbenches on one page. */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.colorScheme;
  for (const [key, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--lw-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value);
  }
}

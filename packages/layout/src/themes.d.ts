import type { Theme, ThemeTokens } from './types.js';
export declare function extendTheme(base: Theme, overrides: Pick<Theme, 'id' | 'label'> & {
    colorScheme?: Theme['colorScheme'];
    tokens?: Partial<ThemeTokens>;
}): Theme;
export declare const builtinThemes: Theme[];
/** Scoped tokens allow multiple differently themed workbenches on one page. */
export declare function applyTheme(root: HTMLElement, theme: Theme): void;

import type { LayoutAdapter, LayoutImplementation, LayoutTemplate } from './types.js';
/** Keep declarative application metadata separate from language/runtime hooks. */
export declare function defineAdapter<Model>(template: LayoutTemplate, implementation: LayoutImplementation<Model>): LayoutAdapter<Model>;

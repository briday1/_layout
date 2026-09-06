import type { LayoutAdapter, Workbench, WorkbenchOptions } from './types.js';
export declare function createWorkbench<Model>(root: HTMLElement, adapter: LayoutAdapter<Model>, options?: WorkbenchOptions): Workbench;

/** UTF-16 offsets, start inclusive and end exclusive (like textarea selection). */
export interface SourceRange { start: number; end: number }
export interface TextEdit extends SourceRange { text: string }
export interface SourceObject {
  id: string;
  label: string;
  kind: string;
  range: SourceRange;
}
export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  range?: SourceRange;
}
export interface ParsedDocument<Model> {
  model: Model;
  objects: SourceObject[];
  diagnostics?: Diagnostic[];
}
export interface InspectorField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'color' | 'select' | 'checkbox';
  value: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  readOnly?: boolean;
}
export type ThemeTokens = Record<
  'background' | 'surface' | 'surfaceRaised' | 'text' | 'muted' |
  'border' | 'accent' | 'accentText' | 'selection' | 'danger' |
  'preview' | 'previewText' | 'font' | 'editorFont', string
>;
export interface Theme {
  id: string;
  label: string;
  colorScheme: 'light' | 'dark';
  tokens: ThemeTokens;
}
export interface DocumentContext<Model> {
  source: string;
  model: Model;
  selection: SourceObject | null;
}
export interface RenderContext<Model> extends DocumentContext<Model> {
  container: HTMLElement;
  theme: Theme;
  signal: AbortSignal;
  select: (id: string) => void;
  reveal: (range: SourceRange) => void;
  edit: (edits: TextEdit[]) => void;
}
export interface ExportFormat<Model> {
  id: string;
  label: string;
  extension: string;
  mimeType: string;
  export: (context: DocumentContext<Model> & { theme: Theme }) =>
    string | Blob | Promise<string | Blob>;
}
export interface WorkbenchCommand<Model> {
  id: string;
  label: string;
  run: (context: DocumentContext<Model>) => TextEdit[];
}
/** Adapters own domain syntax/rendering; the workbench owns all document state. */
export interface LayoutAdapter<Model> {
  id: string;
  title: string;
  extension: string;
  initialSource: string;
  parse: (source: string, signal: AbortSignal) =>
    ParsedDocument<Model> | Promise<ParsedDocument<Model>>;
  render: (context: RenderContext<Model>) =>
    void | (() => void) | Promise<void | (() => void)>;
  inspect?: (context: DocumentContext<Model>) => InspectorField[];
  update?: (context: DocumentContext<Model> & {
    field: string; value: string | number | boolean;
  }) => TextEdit[];
  commands?: WorkbenchCommand<Model>[];
  exports?: ExportFormat<Model>[];
}
export interface WorkbenchOptions {
  /** Unique per document/app. Set to false to disable persistence. */
  storageKey?: string | false;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  themes?: Theme[];
  theme?: string;
  source?: string;
  /** Optional editor language integrations can observe every source change. */
  onChange?: (source: string) => void;
}
export interface Workbench {
  getSource(): string;
  setSource(source: string): void;
  select(id: string | null): void;
  setTheme(id: string): void;
  destroy(): void;
}

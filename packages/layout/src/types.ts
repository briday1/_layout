/** UTF-16 offsets, start inclusive and end exclusive (like textarea selection). */
export interface SourceRange { start: number; end: number }
export interface TextEdit extends SourceRange { text: string }

export interface SourceObject {
  id: string;
  label: string;
  kind: string;
  range: SourceRange;
  /** Secondary text shown muted in the navigator (e.g. a value or date span). */
  detail?: string;
  /** Strikethrough in the navigator for hidden objects. */
  hidden?: boolean;
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

export type InspectorFieldType =
  'text' | 'textarea' | 'number' | 'color' | 'select' | 'checkbox' | 'date';

export interface InspectorField {
  id: string;
  label: string;
  type: InspectorFieldType;
  value: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  readOnly?: boolean;
  placeholder?: string;
  /** Hint text shown under the field. */
  help?: string;
}

/** A titled group of inspector fields; preserves per-domain settings sections. */
export interface InspectorSection {
  id: string;
  title?: string;
  fields: InspectorField[];
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

/**
 * Capability flags declare which workbench features an adapter uses. The shell
 * only renders chrome for enabled capabilities, so a target never inherits
 * flattened least-common-denominator UI from another target.
 */
export interface AdapterCapabilities {
  /** Show the object navigator panel. Default true. */
  navigator?: boolean;
  /** Show the property inspector panel (requires `inspect`). Default true. */
  inspector?: boolean;
  /** Group navigator objects under per-kind headings. Default false. */
  navigatorGroups?: boolean;
  /** Attach pan/zoom viewport controls to the preview. Defaults to template preview kind. */
  panZoom?: boolean;
}

/** A named preview surface an adapter can render (e.g. "Chart" vs "Table"). */
export interface CanvasProfile {
  id: string;
  label: string;
}

/** Declares a companion source document edited in its own tab. */
export interface CompanionSource {
  id: string;
  label: string;
  extension: string;
  initialSource: string;
  language?: string;
}

/**
 * Exact-rendering style contract. Adapters receive both the workbench theme
 * (editor chrome) and resolved artwork defaults (preview surface). Explicit
 * document/figure settings always win over `artwork` values.
 */
export interface StyleProfile {
  /** Maps workbench themes onto adapter artwork tokens. */
  artwork: (theme: Theme) => Record<string, string>;
}

export interface LayoutTemplate {
  id: string;
  title: string;
  extension: string;
  initialSource: string;
  language?: string;
  /** Document previews scroll normally; canvases opt in to shared pan/zoom. */
  preview?: 'document' | 'canvas';
  /** Preview surfaces; when two or more are declared the shell shows tabs. */
  canvases?: CanvasProfile[];
  /** Companion source documents (own editor tabs, persisted, passed to parse/render). */
  sources?: CompanionSource[];
  capabilities?: AdapterCapabilities;
  styleProfile?: StyleProfile;
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
  /** Active canvas when the adapter declares multiple canvases. */
  canvas: string;
  /** Resolved companion sources, in `sources` declaration order. */
  companionSources: string[];
  select: (id: string) => void;
  reveal: (range: SourceRange) => void;
  edit: (edits: TextEdit[]) => void;
}

export interface RenderHandle {
  destroy(): void;
  /** Update highlights without restarting a worker or rebuilding the preview. */
  select?: (selection: SourceObject | null) => void;
}

export interface ExportFormat<Model> {
  id: string;
  label: string;
  extension: string;
  mimeType: string;
  /** Canvases this export applies to; omit to offer it on every canvas. */
  canvases?: string[];
  export: (context: DocumentContext<Model> & {
    theme: Theme;
    canvas: string;
    companionSources: string[];
    signal?: AbortSignal;
  }) => string | Blob | Promise<string | Blob>;
}

export interface WorkbenchCommand<Model> {
  id: string;
  label: string;
  /** Optional toolbar grouping; commands cluster by group. */
  group?: string;
  run: (context: DocumentContext<Model>) => TextEdit[];
}

/** Adapters own domain syntax/rendering; the workbench owns all document state. */
export interface LayoutAdapter<Model> extends LayoutTemplate {
  parse: (source: string, signal: AbortSignal, companions?: readonly string[]) =>
    ParsedDocument<Model> | Promise<ParsedDocument<Model>>;
  render: (context: RenderContext<Model>) =>
    void | (() => void) | RenderHandle | Promise<void | (() => void) | RenderHandle>;
  inspect?: (context: DocumentContext<Model>) =>
    InspectorField[] | InspectorSection[];
  update?: (context: DocumentContext<Model> & {
    field: string; value: string | number | boolean;
  }) => TextEdit[];
  commands?: WorkbenchCommand<Model>[];
  exports?: ExportFormat<Model>[];
}

export type LayoutImplementation<Model> = Omit<LayoutAdapter<Model>, keyof LayoutTemplate>;

export interface SourceEditor {
  /** Programmatic writes must not emit onChange or create independent history. */
  setSource(source: string): void;
  reveal(range: SourceRange): void;
  setTheme?(theme: Theme): void;
  setDiagnostics?(diagnostics: readonly Diagnostic[]): void;
  destroy(): void;
}
export interface SourceEditorContext {
  container: HTMLElement;
  source: string;
  language?: string;
  theme: Theme;
  onChange(source: string): void;
  onSelect(range: SourceRange): void;
}
export type SourceEditorFactory = (context: SourceEditorContext) => SourceEditor;

export interface WorkbenchOptions {
  /** Unique per document/app. Set to false to disable persistence. */
  storageKey?: string | false;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  themes?: Theme[];
  theme?: string;
  source?: string;
  /** Initial companion source contents, keyed by companion id. */
  companionSources?: Record<string, string>;
  /** Canvas to select initially; defaults to the first declared canvas. */
  canvas?: string;
  createEditor?: SourceEditorFactory;
  onChange?: (source: string) => void;
}

export interface Workbench {
  getSource(): string;
  setSource(source: string): void;
  /** Active companion source id, or null when on the primary document. */
  getActiveSourceId(): string | null;
  setActiveSource(id: string | null): void;
  select(id: string | null): void;
  reveal(range: SourceRange): void;
  edit(edits: TextEdit[]): void;
  setTheme(id: string): void;
  /** Switch the preview canvas when the adapter declares several. */
  setCanvas(id: string): void;
  destroy(): void;
}

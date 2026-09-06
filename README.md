# _layout

A capability-first source workbench: one shared editor/preview/inspector engine
that hosts **domain adapters** faithful to the three reference applications —
[pugflow](https://github.com/briday1/pugflow),
[pug-sankey](https://github.com/briday1/pug-sankey), and
[jsonantt](https://github.com/briday1/jsonantt). Each target keeps its own
parser, renderer, DSL, and features; `_layout` supplies the surrounding
document shell (undo/redo, selection, transactions, theming, exports).

**This is a breaking-change release.** See
[Breaking changes and migration](#breaking-changes-and-migration).

**Example site:** https://briday1.github.io/_layout/ — a gallery with all three
applications (`?app=pug-sankey`, `?app=pugflow`, `?app=jsonantt`).

## Run locally

Requires Node.js **22.23+** and npm.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. Everything runs locally in the browser: no account,
API key, Python runtime, CDN, or application server is required. Documents are
stored in this browser's local storage, not uploaded.

```sh
npm run build       # build all four libraries and the four example apps
npm run typecheck
npm test
npm run preview     # inspect the production gallery
```

Each app also builds standalone: `examples/pug-sankey/dist`,
`examples/pugflow/dist`, `examples/jsonantt/dist`, `examples/portal/dist`.
Relative asset URLs support GitHub project Pages and other subdirectory hosts.

## Architecture: a capability-first core

The core insight from auditing the three targets is that they share **document
workflows** (edit → parse → preview → select → inspect → export) but not
**rendering semantics**. A Sankey ribbon, a Pugflow block shape, and a Gantt
bar have nothing in common below "selectable thing in a preview". So the core
is deliberately minimal and each capability is **declared, typed, and
explicit**:

| Capability | Contract | Used by |
| --- | --- | --- |
| `parse(source, signal, companions)` | `{ model, objects, diagnostics }` — model is fully adapter-owned | all |
| `render(context)` | Draw into a fresh container per canvas; return a `RenderHandle` | all |
| `canvases` | Named preview surfaces (e.g. Gantt vs Table); the shell renders tabs only when ≥2 | jsonantt |
| `sources` (companion documents) | Extra editable source tabs (e.g. reusable-style CSS) passed to parse/render | pugflow |
| `capabilities.navigatorGroups` | Group navigator objects under per-kind headings (Nodes / Flows / Graphs…) | pugflow, jsonantt |
| `capabilities.panZoom` | Attach shared pan/zoom viewport controls to the preview | pugflow, pug-sankey |
| `inspect → InspectorSection[]` | Titled field sections per selection (Identity, Style, Routing, Time axis…) | all |
| `update → TextEdit[]` | Atomic source patches; never mutate the model or DOM | all |
| `commands` | Domain actions ("Add node", "Add task") with toolbar grouping | all |
| `exports` | Per-canvas output formats (SVG/PNG/CSV), async, cancelable | all |
| `styleProfile.artwork(theme)` | Map workbench themes onto adapter artwork tokens; document settings always win | all |

Explicit capabilities replace the previous least-common-denominator UI: the
shell only renders chrome a target actually uses, and each adapter's own engine
produces the artwork. Nothing is flattened across targets.

## Packages

| Package | Owns | Upstream provenance |
| --- | --- | --- |
| `@briday1/layout` (`packages/layout`) | Document state, undo/redo, atomic source edits, selection, async preview lifecycle, inspector, modes, recovery, imports/downloads, SVG→PNG, themes, viewport | — |
| `@briday1/layout-pug-sankey` (`packages/pug-sankey`) | Sankey DSL parser, solid-ribbon renderer, 12 flow shapes, annotations, blend, diagram settings | `engine/` is **byte-verified** against pug-sankey @ `3238001` (one browser-tolerance guard noted in `UPSTREAM.json`) |
| `@briday1/layout-pugflow` (`packages/pugflow`) | Pug flow-diagram DSL, grid layout, block shapes, orthogonal connectors, arrowheads, reusable `@node`/`@flow` styles + companion CSS | `engine/` vendored from pugflow @ `91d7c63` (`renderSvg` export, canvas-measure fallback, per-document marker IDs; see `UPSTREAM.json`) |
| `@briday1/layout-jsonantt` (`packages/jsonantt`) | JSON chart model, task tree, durations, `not_before` chains, fiscal/calendar ticks, gantt + table SVG renderers | `engine/` is a TypeScript port of jsonantt @ `df29d44` (`models.py`, `parser.py`, `renderer.py`, `value_format.py`) with identical defaults and geometry constants |

Each package records its exact upstream revision and every deliberate
modification in its `UPSTREAM.json`. Updates to vendored engines should be
deliberate version bumps, not silent tracking of upstream `main`.

## Define an application

```ts
import { createWorkbench } from '@briday1/layout';
import { createPugflowAdapter } from '@briday1/layout-pugflow';
import '@briday1/layout/styles.css';

const app = createWorkbench(
  document.querySelector<HTMLElement>('#app')!,
  createPugflowAdapter(initialPug, initialCss),
  { storageKey: 'my-app:document-1' },
);

// When the host removes this view:
app.destroy();
```

The full public types are in `packages/layout/src/types.ts`. A minimal adapter
implements `parse` and `render`; everything else is an opt-in capability.

### Source mapping and transactions

Ranges use **UTF-16 character offsets**, start-inclusive and end-exclusive,
matching JavaScript strings and textarea selections. `applyEdits(source, edits)`
validates the entire batch before applying it: integer offsets, bounds, and
non-overlap. Adapters return small source patches that preserve comments and
unrelated formatting, and derive fresh models/ranges after every edit.

Object IDs should remain stable across ordinary edits. A renderer can map
multiple visual elements to one object, or use `reveal` for finer selection.

Renderers receive a fresh container for each render and must use the supplied
theme rather than relying on an attached DOM ancestor. Release observers,
subscriptions, workers and resources in the returned cleanup function, and
honor the cancellation signal where possible.

Adapters are **trusted application code**, not sandboxed third-party plugins.
Use safe DOM creation for source text; sanitize external SVG/HTML before
inserting it. The Sankey boundary rejects CSS statements and external paint
URLs in source styling; the Pugflow boundary runs the same validation. The
shared PNG helper caps canvas allocation at 16 megapixels.

### Storage and host integration

The default recovery key is namespaced by adapter ID, with companion sources
persisted per-document (`…:styles`). Supply a unique `storageKey` for each
independent document; set `storageKey: false` for ephemeral documents or supply
a Storage-compatible `storage` implementation. Malformed data, blocked storage
and quota errors must not prevent editing.

Undo/redo stacks are kept **per source document** (primary + each companion).

## Inheritable themes

Light, Dark, Solarized Light, Solarized Dark, Espresso, Dracula, Tokyo Night,
and Synth Wave map onto shared semantic tokens.

```ts
import { builtinThemes, extendTheme } from '@briday1/layout';

const branded = extendTheme(builtinThemes[1], {
  id: 'my-brand', label: 'My brand',
  tokens: { accent: '#70c9b1' },
});
// Pass themes: [...builtinThemes, branded] to createWorkbench.
```

Adapters receive the resolved theme and decide how to use its preview tokens;
each target's `styleProfile.artwork` maps those tokens onto its engine's
`--diagram-*` variables or figure defaults. **Explicit document settings always
win over theme-derived artwork defaults.**

## Target capability matrix

| Feature | pug-sankey | pugflow | jsonantt |
| --- | --- | --- | --- |
| DSL / format | Sankey Pug DSL | Pug flow DSL | JSON |
| Upstream engine | vendored verbatim | vendored verbatim | ported (matplotlib → SVG) |
| Flow shapes / block shapes | 12 flow themes | 7 shapes + 5 arrowheads | — |
| Reusable styles | `@node/@flow/@annotation` | `@node/@flow/@graph` + CSS companion | `style` object |
| Annotations | node/flow, above/below | node/flow/graph | — |
| Companion source | — | Styles.css tab | — |
| Canvases | preview | canvas | Gantt + Table tabs |
| Exports | SVG, PNG | SVG, PNG | SVG, PNG, CSV |
| Dependency links | feedback loops | cross-graph flows | arrows, `not_before` |
| Known gaps vs upstream | Vim mode, drag offsets, Clean Up | Vim mode, drag offsets, Clean Up, MathJax (host may supply), image `href` assets | matplotlib-only canvases (burn charts, compare mode), PDF output, Python CLI |

Gaps are deliberate scope boundaries, not silent omissions: the workbench
reproduces each target's **document format, rendering, and editing surface**;
upstream desktop chrome (Vim emulation, file-system pickers, Python CLIs,
Pyodide workers) stays in the original applications.

## Breaking changes and migration

**From the pre-release `_layout` workbench (the Sankey-only slice):**

1. **`LayoutAdapter` contract extended (breaking).**
   - `parse(source, signal)` → `parse(source, signal, companions)`.
   - `render(context)` gains `context.canvas` and `context.companionSources`.
   - `inspect(context)` may return `InspectorSection[]` (titled sections) or the
     legacy flat `InspectorField[]`.
   - `exports[].export(context)` gains `context.canvas` and
     `context.companionSources`.
2. **`LayoutTemplate` additions (breaking for templates).** New optional
   `canvases`, `sources`, `capabilities`, `styleProfile` fields.
3. **`Workbench` gains `getActiveSourceId`, `setActiveSource`, `setCanvas`**;
   undo/redo are per source document.
4. **`InspectorField` adds `textarea`, `date`, `placeholder`, `help`.**
5. **New packages** `@briday1/layout-pugflow` and `@briday1/layout-jsonantt`;
   the pug-sankey package is unchanged in name.

**Migrating the dependent repos (pugflow, pug-sankey, jsonantt):**

Each upstream repo should replace its bespoke editor shell with
`createWorkbench` + its adapter from this repo, keeping its document format
unchanged:

- **pug-sankey** → `createSankeyAdapter(source)`. The engine is byte-identical
  to upstream; the workbench replaces `app.mjs`, the textarea/inspector, and
  the export dialogs. Vim mode and drag-offset editing remain upstream-only
  until ported.
- **pugflow** → `createPugflowAdapter(pug, css)`. The companion CSS file becomes
  the `styles` source tab. Multi-graph documents, reusable styles, and cross-
  graph flows work; canvas dragging and the upstream dialogs are not yet ported.
- **jsonantt** → `createJsonanttAdapter(json)`. The Gantt and Table canvases
  map to the upstream chart/table renders. Burn charts, compare mode, and the
  Pyodide worker remain upstream-only.

Migration is a deliberate major-version step for each dependent repo: keep the
upstream Python CLIs for headless rendering, and adopt the adapters for the
interactive web editors.

## Distribution and verification

After `npm run build`, each library contains ESM and TypeScript declarations.
`npm pack --workspace @briday1/layout` (and the other three packages) create
installable artifacts for downstream projects. A registry release is a separate
maintainer action.

Tests cover source transactions, asynchronous lifecycle races, selection,
inspector changes, undo/recovery, theme inheritance, and **fidelity suites for
each target**: the pug-sankey suite renders all eight upstream demo documents
and asserts exact SVG structure (gradients, trunk silhouettes, 12 themes,
annotations); the pugflow suite renders the upstream examples with reusable CSS
styles; the jsonantt suite checks date arithmetic, `not_before` resolution,
milestone chains, palette inheritance, and the gantt/table/CSV outputs.

The Pages workflow runs package/example builds, type checking and tests before
deployment. Browser checks should also cover narrow screens, click-to-source,
theme changes and SVG/PNG/CSV downloads.

# _layout

A reusable source-workbench foundation for rebuilding the three reference
applications —
[pugflow](https://github.com/briday1/pugflow),
[pug-sankey](https://github.com/briday1/pug-sankey), and
[jsonantt](https://github.com/briday1/jsonantt). Each target keeps its own
parser, renderer, DSL, and features; `_layout` supplies composable document
facilities (undo/redo, selection, transactions, persistence, imports and
exports). The recreations remain incomplete: the original applications, not
these examples, are the parity specification.

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

Themes apply to the workbench chrome only. Target renderers retain their
upstream artwork defaults; document settings are the only source of artwork
overrides.

## Upstream inventory and parity matrix

The pinned sources are the specification: pug-sankey
[`3238001`](packages/pug-sankey/UPSTREAM.json), pugflow
[`91d7c63`](packages/pugflow/UPSTREAM.json), and jsonantt
[`df29d44`](packages/jsonantt/UPSTREAM.json). The entries below link each
implemented path to a focused check. A **blocking** result means this repository
does not yet recreate that upstream application exactly.

| Upstream surface | _layout implementation | Verification | Status |
| --- | --- | --- | --- |
| pug-sankey parser, 12 flow themes, ribbons, annotations, SVG/PNG | `packages/pug-sankey/src/{engine,index}.ts` | `tests/sankey*.test.ts` | partial: original editor/Vim, drag offsets, Clean Up, dialogs and runtime/CLI are absent |
| pugflow parser, layout, shapes, arrows, reusable CSS, SVG/PNG | `packages/pugflow/src/{engine,index,source}.ts` | `tests/pugflow.test.ts` | partial: original editor/Vim, drag offsets, Clean Up, image assets, MathJax bundle, dialogs and runtime/CLI are absent |
| jsonantt JSON parser, Gantt/table, CSV/SVG/PNG | `packages/jsonantt/src/{engine,index}.ts` | `tests/jsonantt.test.ts` | blocking: this is a TypeScript approximation, not the Python/matplotlib runtime; burn/compare, PDF, include/file handling, Pyodide and CLI are absent |
| Original application shells, menus, dialogs, file pickers and persistence | `packages/layout/src/workbench.ts` | `tests/workbench.test.ts` | blocking: the generic workbench is not a faithful replacement for the three original UIs |
| Independent original-vs-recreation visual, semantic, interaction and export differential tests | — | — | blocking: only implementation-local unit tests currently exist |

This table deliberately does not reclassify upstream features as desktop chrome
or optional. Until every blocking row is implemented and independently tested
against the pinned originals under deterministic browser/runtime conditions,
this project must not claim exact parity.

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

Do **not** migrate an upstream repository to these adapters yet. The adapters
preserve selected document semantics, but they do not yet preserve the complete
original application interface, runtime surfaces, or output fidelity:

- **pug-sankey** → `createSankeyAdapter(source)` is a reusable engine
  integration, not a replacement for `app.mjs`, its editor, dialogs or CLI.
- **pugflow** → `createPugflowAdapter(pug, css)` carries the Pug/CSS engines,
  but the original editor, asset and MathJax provisioning, dialogs and CLI
  remain required for a full recreation.
- **jsonantt** → `createJsonanttAdapter(json)` is not suitable for migration:
  its renderer is a TypeScript approximation and its Python, Pyodide, PDF,
  comparison, burn-chart and file-composition surfaces are not present.

Migration remains blocked until the parity matrix has no blocking entries.

## Distribution and verification

After `npm run build`, each library contains ESM and TypeScript declarations.
`npm pack --workspace @briday1/layout` (and the other three packages) create
installable artifacts for downstream projects. A registry release is a separate
maintainer action.

Tests cover source transactions, asynchronous lifecycle races, selection,
inspector changes, undo/recovery, theme inheritance, and implementation-local
engine checks. They are not independent parity evidence: they do not run the
pinned original applications, compare deterministic screenshots/DOM/export
fixtures, or exercise original end-to-end interactions.

The Pages workflow runs package/example builds, type checking and tests before
deployment. Browser checks should also cover narrow screens, click-to-source,
theme changes and SVG/PNG/CSV downloads.

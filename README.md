# _layout

A reusable, **source-first editor / preview / inspector workbench**. Applications
provide their language and renderer; `_layout` handles the surrounding editor.
Pug, JSON, Fountain, SVG, HTML, and asynchronous worker/server renderers do not
need to share a document model.

The first working application is **Pug Sankey**, using its original parser and
solid-ribbon rendering engine—not a replacement diagram implementation.

**Example site:** https://briday1.github.io/_layout/  
The included workflow publishes this address after merging to `main` and enabling
**Settings → Pages → Build and deployment → GitHub Actions**. Adding the workflow
alone does not enable Pages or publish the current branch.

## Run locally

Requires Node.js **22.23+** and npm.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. Everything in the example runs locally in the browser:
no account, API key, Python runtime, CDN, or application server is required.
Documents are stored in this browser's local storage, not uploaded.

```sh
npm run build       # build both libraries and the static example
npm run typecheck
npm test
npm run preview     # inspect the production example
```

The deployable page is `examples/pug-sankey/dist`. Relative asset URLs support
GitHub project Pages and other subdirectory hosts.

## Separation of responsibilities

| Location | Owns | Must not own |
| --- | --- | --- |
| `packages/layout` | Document state, undo/redo, atomic source edits, source selection, async preview lifecycle, object navigation, declarative inspector, modes, recovery, imports/downloads, SVG-to-PNG conversion, shared themes | Pug/JSON/Fountain parsing, diagram topology, screenplay rules, Python engines |
| `packages/pug-sankey` | Pug parser/renderer, source maps, node/flow fields, diagram settings, domain commands, SVG/PNG export definitions | Editor shell, local storage, file dialogs, shared history, application theme UI |
| `examples/pug-sankey` | A sample `.pug` document, HTML entry point, small application registration | Duplicated editor or rendering infrastructure |

The example's `src/main.ts` is the complete application wiring. The domain adapter
is independently reusable; its `engine/` directory contains seven unchanged
upstream modules. `packages/pug-sankey/UPSTREAM.json` records the exact revision and
provenance. Updates to those files should be deliberate, not silent tracking of
upstream `main`.

### What is shared today

- Source, split, and preview modes with a responsive, keyboard-accessible shell.
- Preview/object-list selection highlights and reveals source; source caret
  movement selects the containing object and updates its inspector.
- Inspector changes and domain commands modify source through one validated edit
  transaction, then reparse. There is no separately saved canvas document.
- Undo/redo, including Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.
- Asynchronous parse/render hooks, cancellation signals, revision guards, and
  render cleanup. Stale work cannot replace a newer document or edit it.
- Invalid source remains editable and recoverable. Stale preview interactions,
  inspector edits, and domain exports are disabled until it parses successfully.
- Source import/download, adapter-defined exports and commands, versioned draft
  recovery, and optional/replaceable storage.
- Eight inheritable theme families, scoped per workbench rather than globally.

### Sankey features

The original engine preserves branches, merges, feedback loops, self-loops,
annotations, reusable styles, and the common linear quantity scale. Its grammar
is the custom Pug Sankey DSL, **not executable Pug templates**.

Click a node or ribbon to inspect it. The object list includes **Diagram
settings**, where you can change the flow shape, blend, artwork background, and
label/value visibility. Node ID changes update connected endpoints atomically;
deleting a node also removes its flows. Add-node and add-flow commands emit
ordinary editable Pug. SVG and PNG exports render a clean overview without
selection or hover effects.

All twelve flow shapes are retained: Smooth, Wiggly, Angular, Terraced, Arc,
Ripple, Circuit, Zigzag, Staircase, Sail, Dip, and S-bend. These are **document
settings**, distinct from application themes.

## Define an application

The two reusable packages are `@briday1/layout` and
`@briday1/layout-pug-sankey`. They are workspace packages here; this change does
not publish them to npm.

```ts
import { createWorkbench } from '@briday1/layout';
import { createSankeyAdapter } from '@briday1/layout-pug-sankey';
import '@briday1/layout/styles.css';

const app = createWorkbench(
  document.querySelector<HTMLElement>('#app')!,
  createSankeyAdapter(initialPug),
  { storageKey: 'my-app:document-1' },
);

// When the host removes this view:
app.destroy();
```

For a different language, implement `LayoutAdapter<Model>`. Its metadata
(`id`, `title`, `extension`, `initialSource`) is the application template; its
hooks are the implementation. Only `parse` and `render` are required:

| Hook | Contract |
| --- | --- |
| `parse(source, signal)` | Return `{ model, objects, diagnostics? }`, synchronously or asynchronously. Each selectable object has an ID, label, kind and source range. |
| `render(context)` | Render into the supplied container. Receive source, model, selection, theme and cancellation signal. Return an optional cleanup function, optionally through a Promise. SVG is not required. |
| `render` → `select(id)` | Navigate to a mapped object and show its inspector. |
| `render` → `reveal(range)` | Reveal a character-level source range, including mappings from transformed or generated previews. |
| `render` → `edit(edits)` | Submit a source transaction from a drag operation or editable preview; the host handles history, persistence and reparse. |
| `inspect(context)` | Return text, number, color, select or checkbox fields for the current object. Missing hook means no property form. |
| `update(context)` | Return source edits for a changed inspector field; do not mutate the model or editor DOM. |
| `commands` | Named domain actions that return source edits. |
| `exports` | Named output formats producing strings or Blobs, optionally asynchronously. The host owns download handling. |

The full public types are in `packages/layout/src/types.ts`; the Sankey adapter
is the working reference. Core tests use non-Sankey adapters so that Pug/SVG
assumptions cannot accidentally become framework requirements.

### Source mapping and transactions

Ranges use **UTF-16 character offsets**, start-inclusive and end-exclusive,
matching JavaScript strings and textarea selections. They are not byte offsets
or one-based line numbers. An adapter translates its parser's locations.

`applyEdits(source, edits)` validates the entire batch before applying it:
integer offsets, bounds and nonoverlap. Return small source patches, preserving
comments and unrelated formatting. Derive new models and ranges after every
edit; never use a cached range from an older revision.

Object IDs should remain stable across ordinary edits. A renderer can map
multiple visual elements to one object, or use `reveal` for finer selection.
For Fountain-style transformed text, the adapter owns visible-to-source offset
mapping and caret affinity; the host does not guess from rendered HTML.

Renderers receive a fresh container for each render. They must use the supplied
theme rather than relying on an attached DOM ancestor during preparation.
Release observers, subscriptions, workers and resources in the returned cleanup
function, and honor the cancellation signal where possible. Late results and
callbacks are ignored even if an underlying backend cannot cancel.

Adapters are **trusted application code**, not sandboxed third-party plugins.
Use safe DOM creation for source text; sanitize external SVG/HTML before inserting
it. The Sankey boundary rejects CSS statements and external paint URLs in
source styling. The shared PNG helper accepts self-contained renderer SVG and
caps canvas allocation at 16 megapixels.

### Storage and host integration

The default recovery key is namespaced by adapter ID. Supply a unique
`storageKey` for each independent document; deliberately sharing a key shares
the draft. Set `storageKey: false` for ephemeral/private documents or supply a
Storage-compatible `storage` implementation. Malformed data, blocked storage
and quota errors must not prevent editing.

An explicit `source` option overrides a recovered draft. `onChange(source)`
lets a host observe updates. The returned workbench supports `getSource`,
`setSource`, `select`, `setTheme`, and `destroy`.

Local storage is recovery, **not a backup or encrypted storage**. Download
important documents. File imports are explicit user actions and do not grant
arbitrary filesystem access.

## Inheritable themes

Light, Dark, Solarized Light, Solarized Dark, Espresso, Dracula, Tokyo Night,
and Synth Wave map Fountain Publisher's principal palettes onto shared semantic
tokens. Secondary workbench colors are adapted to the common controls, rather
than copying screenplay-only selectors, chart colors, or animated backgrounds.

```ts
import { builtinThemes, extendTheme } from '@briday1/layout';

const branded = extendTheme(builtinThemes[1], {
  id: 'my-brand',
  label: 'My brand',
  tokens: { accent: '#70c9b1' },
});
// Pass themes: [...builtinThemes, branded] to createWorkbench.
```

Inheritance merges token overrides without mutating the parent. Tokens cover
background, surfaces, text, muted text, borders, accent, selection, danger,
preview colors and fonts. `applyTheme` writes scoped `--lw-*` CSS variables.
The initial light/dark choice follows system preference unless explicitly set
or recovered; choosing a theme does not rewrite the document.

Adapters receive the resolved theme and decide how to use its preview tokens.
Sankey inherits the preview background when `.background` is absent; explicit
artwork backgrounds and label colors take precedence. A print-oriented adapter
can keep white paper independent of the application theme.

## Reference applications and migration boundary

The comparison found shared editing workflows, not one universal renderer:

| Reference | Domain responsibilities that stay in its adapter |
| --- | --- |
| [pugflow](https://github.com/briday1/pugflow) | Graph/image geometry, mathematical labels, Pug parser, source-backed geometry changes; optional separate reusable-style source |
| [pug-sankey](https://github.com/briday1/pug-sankey) | Weighted flows, continuous-ribbon layout, Sankey DSL and artwork settings |
| [jsonantt](https://github.com/briday1/jsonantt) | JSON paths, schedule/settings semantics, matplotlib rendering through a worker/Pyodide or local service |
| [fountain-publisher](https://github.com/briday1/fountain-publisher) | Fountain classification, transformed text mappings, screenplay pagination, analytics and Screenplain/PDF/FDX compilation |

Async parse/render/export boundaries permit worker, WASM, or server-backed
implementations without moving those runtimes into every application shell.
The shared theme families derive from Fountain Publisher
[`styles.css`](https://github.com/briday1/fountain-publisher/blob/b8e2330f95062470590413c6511552ff2d1e06ed/src/fountain_publisher/web/styles.css).

**Scope:** Sankey is the implemented vertical slice. The other repositories have
not been migrated or modified. This is not yet a replacement for their Python
CLIs, multi-file/include workspaces, rich analytics panels, PDF pagination,
Vim modes, or custom syntax-highlighting engines. The default editor is a native
textarea. Keep those language/runtime capabilities in adapters or explicitly
extend the shared contract; do not copy their application shells here.

## Distribution and verification

After `npm run build`, each library contains ESM and TypeScript declarations.
`npm pack --workspace @briday1/layout` and
`npm pack --workspace @briday1/layout-pug-sankey` create installable artifacts
for downstream projects. A registry release is a separate maintainer action.

No new license grant is asserted. The pinned Sankey upstream has no license file,
and the package manifests remain `UNLICENSED`; clarify licensing before
third-party redistribution.

Tests cover source transactions, asynchronous lifecycle races, selection,
inspector changes, undo/recovery, theme inheritance, and the real Sankey
parser/renderer. The Pages workflow runs package/example builds, type checking
and tests before deployment. Browser checks should also cover narrow screens,
click-to-source, theme changes and SVG/PNG downloads.
# Smart Folders — Obsidian plugin

## The objective (read this first)

**Make folders in an Obsidian vault behave like notes.** A folder gets its own
properties (frontmatter) and its own templates. Clicking it opens a page to manage them.

Three things are being built, and nothing else:

1. **Hidden `.osf/` per folder.** Each folder may contain a hidden `.osf/` directory:
   ```
   <folder>/
     .osf/
       frontmatter.yaml     ← the folder's properties, same shape as a note's YAML frontmatter
       templates/
         *.md               ← templates that belong to this folder
   ```
2. **Folder page.** Clicking a folder in the File Explorer opens a page (a custom
   workspace view) with exactly three sections, in this order:
   1. **Properties** — edit `frontmatter.yaml`. Default: **Obsidian's own native
      properties editor** (same types, tag/value autofill, type menu as notes). Setting
      `rawYamlProperties` switches to a plain YAML textarea.
   2. **Subfolders** — the folder's direct child folders; clicking one opens its page.
   3. **Templates** — the folder's own templates (`.osf/templates/`), then
      **Inherited templates** from *every* ancestor folder up to the vault root, listed
      separately and grouped by the ancestor they come from (nearest first).
      If names collide, **the nearest folder's template wins** and farther ones are hidden.
      **Clicking any template creates a new note from it in the folder whose page is open.**
      Folder templates are *purpose-built for that folder* and live only in `.osf/templates/`;
      general templates stay in core Templates/Templater — don't add "link a vault template".
   Folder properties are **not** inherited — only templates are.
   Templates are also usable from the command palette: *"New note from current folder's
   templates"* opens a fuzzy picker of the current folder's own + inherited templates.
   **Template syntax:** if Templater is enabled, Templater parses the template
   (`<% tp.* %>`); otherwise core-Templates vars (`{{title}}`, `{{date}}`, `{{time}}`).
3. **Folder links** (setting `folderLinks`, default on): `[[Folder name]]` links to a folder
   like a note — native `[[` autocomplete, normal link styling, click opens the folder page.
   Notes win name clashes; `[[Folder name/]]` (trailing slash) always means the folder.
   Folder rows in the `[[` suggester carry a folder icon. Hovering a folder link shows a
   folder preview (properties, subfolders) under the same Page preview rules as notes.
   Renaming/moving a folder updates links to it, following Obsidian's "Automatically update
   internal links" option (ask vs. silent), like note renames.
   Linked folders appear in the **Graph view** behind a **"Folders"** toggle in the graph's
   Filters panel (separate for global and local graph), like the native Tags toggle.
4. **Folder properties are real data**, usable the way note properties are (later
   milestones: expose them to other plugins/queries — see `docs/ROADMAP.md`).

If a task doesn't serve one of these, it's out of scope — ask before doing it.

- Plugin id: `smart-folders` · Target: **Obsidian 1.14.4** (`minAppVersion` and the
  pinned `obsidian` types package). Don't bump without being asked.
- Current state and next tasks: **`docs/ROADMAP.md`**. Open design questions and settled
  decisions: **`docs/DECISIONS.md`**. Read both before starting work.

## Commands

| Command | What it does |
| --- | --- |
| `npm run check` | **Run before saying you're done.** typecheck + tests + production build. |
| `npm test` | Vitest unit tests (`tests/**/*.test.ts`). |
| `npm run typecheck` | `tsc --noEmit`, strict mode. |
| `npm run dev` | esbuild watch → `main.js`. |
| `npm run build` | Production bundle → `main.js`. |
| `npm run install:test` | Build and copy into the test vault `~/Desktop/OSFTestEnvironment`. Then reload Obsidian. |
| `OBSIDIAN_VAULT=/path/to/TestVault npm run install:vault` | Same, for another **test** vault. Never point it at a real vault. |

**Test vault:** `/Users/harry/Desktop/OSFTestEnvironment` — the only vault agents may
install into or write to. Templater 2.25.1 is installed and enabled there, so seeded
templates use Templater syntax. Seeded `.osf/` data: root (`Vault note`), `Folder 1`
(properties, `Meeting`, `Daily log`), `Folder 1/Subfolder A` (`Task`) — so
Subfolder A's page shows own + two inherited groups; its `Meeting` overrides Folder 1's. `Sample notes/` holds two notes
with tags and typed properties (date, number, checkbox) so property autofill has data, plus
`Folder links demo.md` (every link form), a note `Folder 2.md` that clashes with folder `Folder 2`,
and `Rename test.md` + folder `Rename me/Child` for testing link updates on folder rename. `Folder 2` is deliberately bare
to test lazy `.osf/` creation.

There is no headless Obsidian. Logic you can't unit-test must be verified by a human in
a test vault — say so explicitly in your summary instead of claiming it works.

## Architecture — strict dependency direction

```
src/core/          PURE. No `obsidian` import, ever. Paths, YAML, template vars, types.
   ↑
src/services/      IO through injected interfaces (OsfFileSystem, YamlCodec). No `obsidian` import.
   ↑
src/integrations/  Obsidian-facing, non-UI: note creation, other plugins (Templater).
src/ui/, src/main.ts, src/settings.ts   Obsidian-facing. Thin. Wiring and rendering only.
```

Why: the `obsidian` npm package is **types only** — importing it at runtime in Vitest
fails. Keeping `core/` and `services/` free of it is what makes them testable.
If you need an Obsidian capability in a service, add a method to an interface in
`src/core/types.ts` and pass the real thing in from `main.ts`.

| File | Role |
| --- | --- |
| `src/core/paths.ts` | All `.osf` path construction. Never hand-build `".osf/..."` strings elsewhere. |
| `src/core/frontmatter.ts` | Parse/validate/serialise `frontmatter.yaml`. Top level must be a mapping. |
| `src/core/template-vars.ts` | `{{title}}`/`{{date}}`/`{{time}}` substitution (non-Templater fallback). |
| `src/core/types.ts` | `FolderFrontmatter`, `YamlCodec`, `OsfFileSystem`, `FolderTemplate`, `TemplateGroup`. |
| `src/services/osf-store.ts` | **The only module that reads/writes `.osf/`.** Own + inherited template listing. |
| `src/integrations/note-creator.ts` | Create a note in a folder from a template (Templater or fallback), open it. |
| `src/integrations/templater.ts` | Feature-checked access to Templater's private API. |
| `src/integrations/native-properties.ts` | Reuses Obsidian's private MetadataEditor for folder properties. **Fragile — read its header.** |
| `src/core/folder-links.ts` | Folder link resolution (`FolderIndex`), suggestion text, graph data transform. Pure. |
| `src/integrations/folder-links.ts` | Patches `isUnresolved`, `getLinkSuggestions`, `WorkspaceLeaf.openLinkText`. **Read its header.** |
| `src/integrations/graph-folders.ts` | Wraps graph `renderer.setData`; injects the "Folders" filter toggle. **Read its header.** |
| `src/integrations/folder-rename.ts` | Rewrites folder links on folder rename/move (body, embeds, frontmatter). |
| `src/ui/folder-hover.ts` | Folder link hover preview content. |
| `src/integrations/patch.ts` | `patchMethod` — the only way to patch Obsidian internals here (auto-restored on unload). |
| `src/integrations/vault-fs.ts` | `OsfFileSystem` over `app.vault.adapter`; `trash` = OS trash, else vault `.trash/`. |
| `src/integrations/system-explorer.ts` | Open a vault folder in Finder/Explorer (desktop only) — how users reach `.osf/templates/`. |
| `src/ui/remove-data-modal.ts` | Confirmation for Settings → "Remove all Smart Folders data". |
| `src/ui/template-picker-modal.ts` | Command-palette fuzzy picker of a folder's templates. |
| `src/ui/folder-page-view.ts` | The folder page (`ItemView`, state `{ path }`). |
| `src/ui/explorer-integration.ts` | File Explorer folder-click hook (DOM-based, see below). |
| `src/main.ts` | Plugin entry: registers view, click hook, context menu, command, settings. |
| `tests/fakes/memory-fs.ts` | In-memory `OsfFileSystem` for service tests. |

## Obsidian facts that will bite you

- **Obsidian does not index dot-folders.** `.osf/` never appears as a `TFolder`/`TFile`,
  never fires vault events, and `app.vault.*` file APIs can't see it. All `.osf` IO goes
  through `app.vault.adapter` (the `DataAdapter`), wrapped by `OsfStore`.
- **Folder rename/move is free**: `.osf/` lives inside the folder, so it moves with it.
  Don't build rename tracking.
- **No public "folder clicked" API.** We listen for clicks on `.nav-folder-title[data-path]`
  in `explorer-integration.ts`. Don't `preventDefault` — folders must still expand/collapse.
  If folder clicks break after an Obsidian update, this selector is the first suspect.
- **Templater can't see `.osf/` templates as files** (no TFile). We pass the template's
  *text* to `templater.create_new_note_from_template(text, folder, name, true)`, which
  Templater supports for strings (verified against 2.20.6 and 2.25.1). It's private API —
  keep every access in `integrations/templater.ts`, feature-checked.
- **Native properties editor is private API.** `integrations/native-properties.ts` takes the
  MetadataEditor class from an open MarkdownView (or a throwaway one) and gives it our own
  `owner`. The owner contract was read from Obsidian 1.14.4's bundled `app.js`; **if you bump
  Obsidian, re-verify it** (extract `~/Library/Application Support/obsidian/obsidian-<ver>.asar`
  with `npx @electron/asar extract` into the scratchpad and grep `metadataEditor=new`). Any failure must
  fall back to the raw YAML editor, never crash the page. Property *types* live in
  `app.metadataTypeManager` and are vault-wide: changing a type on a folder changes it for notes too (intended).
- **Folder links + graph patch Obsidian internals** (see the two integration headers for the
  exact functions). Always use `patchMethod` and `this.register(uninstall)`; never assign over
  an Obsidian method directly. Every patch must be a pass-through when `folderLinks` is off.
- **YAML**: in the plugin use Obsidian's `parseYaml`/`stringifyYaml`; in tests use the
  `yaml` package. Both reach core code only through `YamlCodec`.
- **Root folder** path is `"/"` in Obsidian; `normalizeFolderPath` turns it into `""`.
  Root's `.osf` is `<vault>/.osf/`.
- Use `this.register*` (`registerEvent`, `registerDomEvent`, `registerView`) for anything
  that needs cleanup on unload. No raw `addEventListener` on global objects.
- **The page re-renders its Templates card on window focus** (users add templates in
  Finder; dot-folders fire no vault events). Never re-render the whole page on focus —
  it would wipe unsaved property edits. Same for vault events: the page follows renames/deletes and
  redraws only its header / Subfolders / Templates slots, never Properties.
- Styling: Obsidian CSS variables only (`var(--text-muted)` etc.), classes prefixed
  `smart-folders-`, all in `styles.css`. No inline styles.

## Rules for working here

- **Tests first for core/services.** Any new logic in `core/` or `services/` gets a
  Vitest test in the mirrored path under `tests/`. UI code stays thin enough not to need one.
- **Never write invalid YAML to disk.** Validate via `parseFrontmatter` before every write.
- **Never delete or overwrite user files** in `.osf/` without an explicit user action. The only
  removal path is `OsfStore.removeOsf` (trash, never hard delete), behind a confirmation.
  Create `.osf/` lazily — only when the user saves something, not on folder view.
- One feature per change. Update `docs/ROADMAP.md` (tick the box) in the same change.
- New design question? Add it to `docs/DECISIONS.md` under *Open* — don't silently pick.
- Code style: tabs, strict TS, no `any`, small functions, a top-of-file comment saying
  what the module is for. Match the existing files.
- Don't add runtime dependencies without asking; the bundle should stay tiny.
- Don't edit `main.js` (generated) or commit it.

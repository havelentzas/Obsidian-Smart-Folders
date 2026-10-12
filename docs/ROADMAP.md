# Roadmap

Tick boxes in the same change that completes them. Each item should be a small, testable unit.

## M0 — Scaffold ✅
- [x] Plugin boilerplate for Obsidian 1.14.4 (esbuild, strict TS, Vitest)
- [x] `.osf` path helpers + YAML parse/validate (pure, tested)
- [x] `OsfStore`: read/write `frontmatter.yaml`, list templates (tested with in-memory fs)
- [x] Folder page view with Properties (raw YAML textarea), Subfolders, Templates (list only)
- [x] Open folder page via: explorer click (toggleable), folder context menu, command

## M1 — Usable folder page
- [x] Verify in a test vault on Obsidian 1.14.4: click hook, view restore after restart, root folder
- [x] Properties: Obsidian's native properties editor (types, autofill, type menu); setting to use raw YAML instead
- [x] Verify native editor in the test vault: add/rename/delete, change type, tag autofill, reorder, sidebar, with no note open (throwaway-MarkdownView path)
- [x] Re-render the page when the folder's children change (vault `create`/`delete`/`rename` events)
- [x] Handle the open folder being renamed or deleted while its page is open
- [x] Verify: rename/move the open folder and an ancestor (title, breadcrumbs, tab title, survives restart); add/delete a subfolder; delete the open folder

- [x] Setting: open folder page in main area or right sidebar
- [x] Verify sidebar mode: page reuses one sidebar tab; template-created notes open in the main area, not the sidebar

## M2 — Templates
- [x] Inherited templates from all ancestors, listed separately, grouped by source folder
- [x] Nearest-wins shadowing for same-named templates
- [x] Click a template → new note from it in the open page's folder
- [x] Command palette: "New note from current folder's templates" (fuzzy picker)
- [x] Templater syntax when Templater is enabled; `{{title}}`/`{{date}}`/`{{time}}` otherwise
- [x] Verify in the test vault: Templater path, fallback path (Templater disabled), root templates
- [ ] "Add template" button: create `.osf/templates/<name>.md` and open it for editing
- [ ] Open / rename / delete a template from the page (delete asks for confirmation)
- [x] Open templates folder button (big empty-state CTA / small accented + in header); opens in Finder
- [x] Templates card refreshes on window focus (dot-folders fire no vault events)
- [x] Visual pass: header with breadcrumbs, cards, tiles, theme-aware accents
- [x] Verify the visual pass in light + dark theme and in the right sidebar

## M2.5 — Folder links
- [x] `[[Folder name]]` / `[[Folder name/]]` resolution, notes win (pure, tested)
- [x] Native `[[` autocomplete includes folders; folder links styled as resolved; click opens folder page
- [x] Graph: folder nodes + "Folders" filter toggle (global + local)
- [x] Verify in test vault: `Sample notes/Folder links demo.md` in Live Preview, Source, Reading; graph toggle; local graph; cmd-click opens new tab
- [x] Folder icon flair on folder entries in the `[[` suggester
- [x] Hover preview for folder links (respects Page preview modifier settings)
- [x] Update folder links on folder rename/move (ask vs. auto per Obsidian's option)
- [x] Verify: rename `Rename me` with `Sample notes/Rename test.md` open; both option states; hover in LP + reading view

## Tabs
- [x] Focus an already open folder page instead of opening a duplicate (setting `focusExistingPage`)
- [x] Verify: explorer click, [[link]] click, Cmd-click (no empty tab left), sidebar mode, setting off

## Data removal
- [x] Settings button "Remove all Smart Folders data": confirm with folder list, trash every `.osf/`
- [x] Verify in the test vault (then restore the seeded `.osf/` folders from the trash)

## M3 — Folder properties as data
- [x] Public, versioned API `plugin.api` (properties read/write, templates, link resolution, open page, data paths) + workspace events `smart-folders:ready` / `smart-folders:properties-changed` — `docs/API.md`
- [x] Folder page updates live when properties change elsewhere (API, Finder edit on refocus)
- [x] Verify from the dev console: `app.plugins.plugins['smart-folders'].api` read/write; open folder page updates
- [x] In-memory cache of folder frontmatter, invalidated on save (+ rebuild on focus, rename/delete)
- [x] Folder property names, values and tags in Obsidian's suggestions (setting `folderPropertySuggestions`)
- [x] Verify: `osf-client` and `#osf-folder-only` (only on Folder 1/Subfolder A) are suggested in a note's properties, `#` in the editor, Tags view; edit in Finder → appears after refocus
- [ ] Iconic: folder rules can use folder properties (runtime patch of Iconic's RuleManager.judgeFile + rule editor source list; verified feasible against Iconic 1.1.10)

## Later / unsorted
- [ ] Indicator in the File Explorer for folders that have `.osf/`
- [ ] Mobile check (`isDesktopOnly: false` is set; untested)

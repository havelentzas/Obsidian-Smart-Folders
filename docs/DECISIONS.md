# Decisions

## Settled

- **Purpose of folder templates**: purpose-built templates for a specific folder (and its
  subfolders). They live ONLY in `.osf/templates/`. No pointing at templates elsewhere in the
  vault — general-purpose templates belong in core Templates / Templater folders.
- **Storage**: `<folder>/.osf/frontmatter.yaml` for properties, `<folder>/.osf/templates/*.md`
  for templates. Hidden so the File Explorer stays clean; inside the folder so it moves with it.
- **IO via `DataAdapter`**, not the Vault API, because Obsidian doesn't index dot-folders.
- **`.osf/` is created lazily** on first save, never just by viewing a folder.
- **Frontmatter top level must be a YAML mapping**; anything else is rejected before writing.
- **Templates are inherited** from every ancestor up to the vault root. The page lists the
  folder's own templates, then inherited ones grouped by source folder (nearest first).
  **Nearest folder wins**: if names collide (case-insensitive), the template in the folder
  itself or the nearest ancestor is used; farther same-named templates are hidden everywhere
  (page and command palette). Logic: `core/templates.ts`.
- **Template syntax**: Templater when enabled; otherwise `{{title}}`, `{{date[:fmt]}}`,
  `{{time[:fmt]}}` with defaults `YYYY-MM-DD` / `HH:mm` (core Templates' configured
  formats are not read).
- **New notes from templates** are named "Untitled" (next free number) in the target
  folder and opened with the title selected for renaming, like Obsidian's "New note".
- **Folder click** opens the page in the current tab *and* still toggles expand/collapse.
  Controlled by the `openOnFolderClick` setting (default on).
- **Where the page opens**: `openInRightSidebar` setting (default off = main area, replacing
  the current tab). On = right sidebar, reusing an existing sidebar folder page if present.
  Notes created from templates always open in the main area.
- **Already open → focus it**: `focusExistingPage` (default on). Opening a folder whose page is
  open in any tab (main, sidebar, popout) focuses that tab — from clicks, links, breadcrumbs,
  hover. A Ctrl/Cmd-click's fresh empty tab is closed. Off = old behaviour.

- **Folder properties use Obsidian's native properties editor** (private API, feature-checked,
  falls back to raw YAML). Property types are shared vault-wide with notes.

- **Properties are NOT inherited.** A folder's properties are only its own `frontmatter.yaml`.
  (Templates are inherited; properties deliberately aren't.)

- **Folder links use plain `[[Folder name]]`** (owner's preferred option). Notes win name clashes,
  as with any Obsidian link; a trailing slash `[[Folder name/]]` always targets the folder.
  Ambiguous folder names resolve to the shallowest folder (then alphabetical), and autocomplete
  inserts the full path for them. Toggle: `folderLinks` setting (default on).
- **Graph**: linked folders become nodes (theme `--color-yellow`, overridable via
  `--smart-folders-graph-folder`) behind a "Folders" filter toggle, off by default like Tags.
  Global and local graph have separate toggles. Folder links never show as "unresolved" nodes.

- **Folder renames update links**, mirroring Obsidian's note-rename flow: silent + notice if
  "Automatically update internal links" is on, otherwise ask (Always update / Just once / Don't
  update). Link style is preserved (name stays name, path stays path, trailing slash kept).
  Covers wikilinks, embeds, markdown links and frontmatter links.
- **Hover preview for folder links**: compact read-only folder page; obeys core Page preview's
  modifier-key settings because it hooks in after them.
- **Folder icon in the `[[` suggester** (folder flair on the right, parent path as the note line).

- **Sync: leave `.osf/` as is (for now).** Obsidian Sync skips dot-folders other than
  `.obsidian/`, so folder data doesn't sync through it; iCloud/Syncthing/Git do sync it.
  A visible `_osf/` storage mode was proposed and declined for now — don't build it unasked.
- **Removing all data**: a settings button trashes every `.osf/` (OS trash, else vault
  `.trash/`; never a hard delete) after a confirmation listing the folders. Notes, folders,
  `[[Folder]]` links and plugin settings are left alone.

- **Folder properties in suggestions** (setting `folderPropertySuggestions`, default on):
  folder property names (with inferred types), string values and tags are merged into
  Obsidian's own suggestion sources. Notes win: an existing property keeps its type. Side
  effect, accepted: folder tags also show in the Tags view (clicking searches notes only), and
  folder-only property names show in Bases / "All properties".
- **Folder properties cache**: `FolderPropertiesIndex` (in memory), rebuilt on startup and on
  window focus, updated on our own saves and folder rename/delete.
- **Public API** (`plugin.api`, version 1, `docs/API.md`): facade returning copies; events via
  `app.workspace.trigger` (`smart-folders:ready`, `smart-folders:properties-changed`). Additive
  changes keep the version; breaking ones bump it. Only `api` is public — not the plugin's other members.
- **Iconic integration**: explored, feasible via runtime patches (no fork) — not built yet.

## Open — ask the owner before deciding


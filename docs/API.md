# Smart Folders API

Other plugins can read and write folder properties, use folder templates, resolve folder links
and react to changes through a small, versioned API.

- **API version:** 1
- **Types:** [`src/api/types.ts`](../src/api/types.ts). It's self-contained, so you can copy it into your plugin.

## Getting the API

```ts
import type { SmartFoldersApi } from "./smart-folders-types"; // your copy of src/api/types.ts

function getSmartFolders(app: App): SmartFoldersApi | null {
	const api = (app as any).plugins?.plugins?.["smart-folders"]?.api as SmartFoldersApi | undefined;
	return api && api.apiVersion === 1 ? api : null;
}
```

**Plugin load order:** Smart Folders may load after your plugin.
- Look the API up when you need it, or inside `app.workspace.onLayoutReady`. Don't do it once in `onload`.
- Before using the synchronous getters, check `api.isReady()`, or `await api.whenReady()`.

## Reading and writing properties

```ts
await api.whenReady();
api.getFolderProperties("Projects/Acme");   // { status: "active", tags: ["client"] }, or {} or null
api.getFoldersWithProperties();             // ["Projects/Acme", ...]

await api.setFolderProperties("Projects/Acme", { status: "done" });            // replaces all
await api.updateFolderProperties("Projects/Acme", (p) => ({ ...p, status: "done" })); // edits
```

- **Paths:** vault-relative folder paths. `""` or `"/"` means the vault root, and a trailing slash is ignored.
- **`getFolderProperties` return values:**
  - `null`: the folder doesn't exist.
  - `{}`: the folder exists but has no properties.
  - Otherwise you get a **copy**, so changing it has no effect.
- **Writes:**
  - Saved to `<folder>/.osf/frontmatter.yaml`, which is created if needed.
  - The input must be a plain object; anything else is rejected.
  - Writes are atomic per folder.

## Reacting to changes

```ts
this.registerEvent(
	(this.app.workspace as Events).on("smart-folders:properties-changed", (folderPath, properties) => {
		// properties: the new properties, or null if the folder has none any more
	}),
);
this.registerEvent((this.app.workspace as Events).on("smart-folders:ready", () => { /* cache loaded */ }));
```

`properties-changed` fires once per affected folder when:
- **A folder page saves.** This covers both the native properties editor and raw YAML.
- **Any plugin writes through this API.**
- **A folder is renamed or moved.** The old path is reported with `null` and the new path with its properties.
- **A folder is deleted.** Every folder that had properties under it is reported with `null`.
- **`frontmatter.yaml` is edited outside Obsidian.** The change is picked up when the Obsidian window next regains focus, because Obsidian doesn't watch dot-folders.

It doesn't fire when a folder is saved with the same properties it already had.

`smart-folders:ready` fires once, after startup. If you subscribe late it may already have
fired, so check `api.isReady()`.

## Templates

```ts
const groups = await api.getFolderTemplates("Projects/Acme");
// [{ folderPath: "Projects/Acme", inherited: false, templates: [{ name, path }] },
//  { folderPath: "Projects",      inherited: true,  templates: [...] }, ...]   nearest first
const file = await api.createNoteFromTemplate(groups[0].templates[0], "Projects/Acme");
```

- **Shadowing:** if two folders have templates with the same name, the nearer folder wins and the farther one is left out of the list.
- **Which syntax is used:** if Templater is enabled, Templater processes the template. Otherwise `{{title}}`, `{{date}}` and `{{time}}` are filled in.
- **What you get back:** the new note is opened, and the call resolves to the new `TFile`, or `null` if Templater doesn't report the file.
- **Allowed templates:** only templates returned by `getFolderTemplates` are accepted.

## Links and navigation

```ts
api.resolveFolderLink("Acme", "Notes/today.md");  // "Projects/Acme" | null
await api.openFolderPage("Projects/Acme");
```

`resolveFolderLink` uses the same rules as clicking a link:
- A note with that name wins.
- `[[Name/]]` always means the folder.
- It returns `null` when folder links are turned off.

`openFolderPage` respects the user's settings for where the page opens and whether an already open page is focused.

## Storage paths

`api.getFolderDataPaths(folder)` returns `{ osfDir, propertiesFile, templatesDir }`. Use the
methods above instead of reading these files yourself. They're exposed for tooling such as
backups and exports.

## Compatibility promise

- **Additive changes** keep `apiVersion` the same: new methods, new optional fields and new events.
- **Breaking changes** bump `apiVersion`: removing or renaming something, or changing what a method returns or means.
- **Smart Folders' internals aren't part of the contract:** anything on the plugin object other than `api`, plus the internal patches and the cache.

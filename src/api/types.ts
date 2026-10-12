/**
 * Smart Folders public API — types.
 *
 * Self-contained on purpose: other plugin developers can copy this file into their project.
 * Changing anything here is a contract change: additive changes only within an API version;
 * anything breaking bumps SMART_FOLDERS_API_VERSION (see docs/API.md).
 */

import type { TFile } from "obsidian";

export const SMART_FOLDERS_API_VERSION = 1;

/** A folder's properties: the parsed `.osf/frontmatter.yaml`, same shape as note frontmatter. */
export type FolderProperties = Record<string, unknown>;

export interface FolderTemplateInfo {
	/** Display name (file name without `.md`). */
	name: string;
	/** Vault-relative path of the template file (inside some folder's `.osf/templates/`). */
	path: string;
}

export interface FolderTemplateGroup {
	/** Folder that owns these templates ("" = vault root). */
	folderPath: string;
	/** True for an ancestor's templates, false for the folder's own. */
	inherited: boolean;
	templates: FolderTemplateInfo[];
}

/** Where a folder's Smart Folders data lives (whether or not it exists yet). */
export interface FolderDataPaths {
	osfDir: string;
	propertiesFile: string;
	templatesDir: string;
}

/** Workspace events (subscribe with `app.workspace.on(name, callback)`). */
export interface SmartFoldersEvents {
	/** Fired once the folder properties cache has loaded. Check `api.isReady()` first; it may have fired already. */
	"smart-folders:ready": () => void;
	/**
	 * A folder's properties changed: saved in the folder page or through the API, edited outside
	 * Obsidian (picked up when the window regains focus), or the folder was renamed/moved/deleted.
	 * `properties` is null when the folder no longer has any (a rename reports the old path with
	 * null and the new path with its properties). Treat `properties` as read-only.
	 */
	"smart-folders:properties-changed": (folderPath: string, properties: FolderProperties | null) => void;
}

/**
 * Reach it with `app.plugins.plugins["smart-folders"]?.api` (undefined if Smart Folders is not
 * installed/enabled). Check `apiVersion` before use. All paths are vault-relative folder paths;
 * "" or "/" is the vault root.
 */
export interface SmartFoldersApi {
	/** Bumped only on breaking changes. */
	readonly apiVersion: number;
	/** The Smart Folders plugin version (manifest.json). */
	readonly pluginVersion: string;

	/** True once the properties cache has loaded (synchronous getters return data from then on). */
	isReady(): boolean;
	/** Resolves when the properties cache has loaded. */
	whenReady(): Promise<void>;

	// ── properties ────────────────────────────────────────────────────

	/**
	 * A copy of the folder's properties, from the cache. `{}` if it has none; null if the folder
	 * doesn't exist. Synchronous; correct once `isReady()` is true.
	 */
	getFolderProperties(folderPath: string): FolderProperties | null;
	/** Folders that have at least one property (cache). */
	getFoldersWithProperties(): string[];
	/**
	 * Replace the folder's properties (writes `.osf/frontmatter.yaml`, creating it if needed) and
	 * fires `smart-folders:properties-changed`. Rejects if the folder doesn't exist or `properties`
	 * is not a plain object.
	 */
	setFolderProperties(folderPath: string, properties: FolderProperties): Promise<void>;
	/** Read-modify-write helper: `update` gets a copy of the current properties and returns the new ones. */
	updateFolderProperties(folderPath: string, update: (current: FolderProperties) => FolderProperties): Promise<void>;

	// ── templates ─────────────────────────────────────────────────────

	/** The folder's own templates then each ancestor's (nearest first), with nearer names shadowing farther ones. */
	getFolderTemplates(folderPath: string): Promise<FolderTemplateGroup[]>;
	/**
	 * Create a note in `folderPath` from a template (Templater if enabled, else `{{title}}`/`{{date}}`/
	 * `{{time}}`) and open it. `template` must be one returned by `getFolderTemplates`. Resolves to
	 * the new file, or null if it couldn't be determined (e.g. Templater didn't return one).
	 */
	createNoteFromTemplate(template: FolderTemplateInfo, folderPath: string): Promise<TFile | null>;

	// ── links & navigation ────────────────────────────────────────────

	/**
	 * The folder a link would open (`[[Folder]]`, `[[Folder/]]`, `[[path/to/Folder]]`), following
	 * Smart Folders' rules: a note with that name wins. Null if it's not a folder link or folder
	 * links are turned off.
	 */
	resolveFolderLink(linktext: string, sourcePath: string): string | null;
	/** Open the folder page (respects the user's "open in sidebar" and "focus existing" settings). */
	openFolderPage(folderPath: string): Promise<void>;

	// ── storage ───────────────────────────────────────────────────────

	/** Where Smart Folders keeps this folder's data. Prefer the methods above to reading these files. */
	getFolderDataPaths(folderPath: string): FolderDataPaths;
}

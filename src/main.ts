/**
 * Plugin entry point. Keep this file thin: wiring only (register views, commands,
 * events, settings). Logic belongs in src/core (pure) or src/services (IO).
 */

import { Notice, Plugin, TFolder, WorkspaceLeaf, parseLinktext, parseYaml, stringifyYaml } from "obsidian";
import { createSmartFoldersApi } from "./api/smart-folders-api";
import type { SmartFoldersApi } from "./api/types";
import { VIEW_TYPE_FOLDER_PAGE } from "./constants";
import { normalizeFolderPath } from "./core/paths";
import type { FolderTemplate, YamlCodec } from "./core/types";
import { FolderLinks } from "./integrations/folder-links";
import { installFolderPropertySuggestions } from "./integrations/folder-property-suggestions";
import { FolderRenameLinkUpdater } from "./integrations/folder-rename";
import { GraphFolders } from "./integrations/graph-folders";
import { NoteCreator } from "./integrations/note-creator";
import { openInSystemExplorer } from "./integrations/system-explorer";
import { vaultFs } from "./integrations/vault-fs";
import { FolderPropertiesIndex } from "./services/folder-properties-index";
import { OsfStore } from "./services/osf-store";
import { DEFAULT_SETTINGS, SmartFoldersSettingTab, type SmartFoldersSettings } from "./settings";
import { registerFolderClickHandler } from "./ui/explorer-integration";
import { showFolderHover } from "./ui/folder-hover";
import { FolderPageView, type FolderPageState } from "./ui/folder-page-view";
import { ConfirmRemoveDataModal } from "./ui/remove-data-modal";
import { TemplatePickerModal } from "./ui/template-picker-modal";

export default class SmartFoldersPlugin extends Plugin {
	settings: SmartFoldersSettings = DEFAULT_SETTINGS;
	store!: OsfStore;
	/** Every folder's properties in memory (see getFolderFrontmatter). */
	folderProperties!: FolderPropertiesIndex;
	/** Public API for other plugins — see src/api/types.ts and docs/API.md. */
	api!: SmartFoldersApi;
	noteCreator!: NoteCreator;
	folderLinks!: FolderLinks;
	graphFolders!: GraphFolders;

	async onload(): Promise<void> {
		await this.loadSettings();

		const yaml: YamlCodec = { parse: parseYaml, stringify: stringifyYaml };
		this.store = new OsfStore(vaultFs(this.app.vault.adapter), yaml);
		this.noteCreator = new NoteCreator(this.app, this.store);
		this.installFolderPropertiesIndex();

		this.registerView(
			VIEW_TYPE_FOLDER_PAGE,
			(leaf) =>
				new FolderPageView(leaf, {
					store: this.store,
					openFolderPage: (path) => this.openFolderPage(path),
					createNoteFromTemplate: (template, folderPath) => this.createNoteFromTemplate(template, folderPath),
					openTemplatesFolder: (folderPath) => this.openTemplatesFolder(folderPath),
					useRawYaml: () => this.settings.rawYamlProperties,
				}),
		);

		registerFolderClickHandler(
			this,
			() => this.settings.openOnFolderClick,
			(path) => void this.openFolderPage(path),
		);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFolder)) return;
				menu.addItem((item) =>
					item
						.setTitle("Open folder page")
						.setIcon("folder-cog")
						.onClick(() => void this.openFolderPage(file.path)),
				);
			}),
		);

		this.addCommand({
			id: "open-folder-page-for-active-file",
			name: "Open folder page for current note's folder",
			checkCallback: (checking) => {
				const parent = this.app.workspace.getActiveFile()?.parent;
				if (!parent) return false;
				if (!checking) void this.openFolderPage(parent.path);
				return true;
			},
		});

		this.addCommand({
			id: "new-note-from-folder-template",
			name: "New note from current folder's templates",
			callback: () => void this.openTemplatePicker(this.getCurrentFolderPath()),
		});

		this.installFolderLinks();
		this.installApi();
		this.addSettingTab(new SmartFoldersSettingTab(this.app, this));
	}

	/**
	 * Folder properties cache + folder properties in Obsidian's suggestions. The cache rebuilds on
	 * startup and when the window regains focus (.osf/ edits outside Obsidian fire no events).
	 */
	private installFolderPropertiesIndex(): void {
		this.folderProperties = new FolderPropertiesIndex(this.store);
		const allFolders = () =>
			this.app.vault
				.getAllLoadedFiles()
				.filter((f): f is TFolder => f instanceof TFolder)
				.map((f) => f.path);
		this.app.workspace.onLayoutReady(() => void this.folderProperties.rebuild(allFolders()));
		this.registerDomEvent(window, "focus", () => void this.folderProperties.rebuild(allFolders()));
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFolder) this.folderProperties.rename(oldPath, file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFolder) this.folderProperties.delete(file.path);
			}),
		);
		installFolderPropertySuggestions({
			app: this.app,
			index: this.folderProperties,
			isEnabled: () => this.settings.folderPropertySuggestions,
			register: (cb) => this.register(cb),
		});
	}

	/** Public API object + its workspace events (`smart-folders:ready`, `smart-folders:properties-changed`). */
	private installApi(): void {
		this.api = createSmartFoldersApi({
			app: this.app,
			pluginVersion: this.manifest.version,
			store: this.store,
			index: this.folderProperties,
			createNote: (template, folderPath) => this.noteCreator.createFromTemplate(template, folderPath),
			resolveFolderLink: (linktext, sourcePath) =>
				this.folderLinks.folderForLink(parseLinktext(linktext).path, sourcePath),
			openFolderPage: (path) => this.openFolderPage(path),
		});
		const { workspace } = this.app;
		this.register(
			this.folderProperties.onChange((path, fm) =>
				workspace.trigger("smart-folders:properties-changed", path, fm === null ? null : structuredClone(fm)),
			),
		);
		void this.folderProperties.whenReady().then(() => workspace.trigger("smart-folders:ready"));
	}

	/** [[Folder]] links + graph folder nodes. Both are no-ops while the setting is off. */
	private installFolderLinks(): void {
		const isEnabled = () => this.settings.folderLinks;
		this.folderLinks = new FolderLinks({
			app: this.app,
			isEnabled,
			openFolderFromLink: async (folderPath, leaf) => {
				const existing = this.findOpenFolderPage(folderPath);
				if (existing) {
					// Ctrl/Cmd-click made a fresh empty tab for the link; don't leave it behind.
					if (existing !== leaf && leaf.view.getViewType() === "empty") leaf.detach();
					return this.focusLeaf(existing);
				}
				if (this.settings.openInRightSidebar) return this.openFolderPage(folderPath);
				const state: FolderPageState = { path: folderPath };
				await leaf.setViewState({ type: VIEW_TYPE_FOLDER_PAGE, state, active: true });
			},
			onFoldersChanged: () => this.graphFolders.refresh(),
			showFolderHover: (hoverParent, targetEl, folderPath) =>
				showFolderHover(
					{ app: this.app, store: this.store, openFolderPage: (path) => this.openFolderPage(path) },
					hoverParent,
					targetEl,
					folderPath,
				),
			register: (cb) => this.register(cb),
			registerEvent: (ref) => this.registerEvent(ref),
		});
		this.graphFolders = new GraphFolders({
			app: this.app,
			isEnabled,
			resolve: (linkpath) => this.folderLinks.resolve(linkpath),
			getShowFolders: (type) => (type === "graph" ? this.settings.graphShowFolders : this.settings.localGraphShowFolders),
			setShowFolders: async (type, value) => {
				if (type === "graph") this.settings.graphShowFolders = value;
				else this.settings.localGraphShowFolders = value;
				await this.saveSettings();
			},
			register: (cb) => this.register(cb),
			registerEvent: (ref) => this.registerEvent(ref),
		});
		const renameUpdater = new FolderRenameLinkUpdater({
			app: this.app,
			isEnabled,
			currentFolderPaths: () => this.folderLinks.folderPaths(),
			registerEvent: (ref) => this.registerEvent(ref),
		});
		this.folderLinks.install();
		this.graphFolders.install();
		renameUpdater.install();
	}

	/**
	 * Open a folder page. If that folder's page is already open anywhere, focus it instead
	 * (setting `focusExistingPage`). Otherwise main area: replaces the current tab; right
	 * sidebar: reuses an existing sidebar folder page if there is one, else creates a sidebar tab.
	 */
	async openFolderPage(folderPath: string): Promise<void> {
		const state: FolderPageState = { path: normalizeFolderPath(folderPath) };
		const existing = this.findOpenFolderPage(state.path);
		if (existing) return this.focusLeaf(existing);
		const leaf = this.settings.openInRightSidebar ? this.getRightSidebarLeaf() : this.app.workspace.getLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_FOLDER_PAGE, state, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * A tab already showing this folder's page, or null (also null when `focusExistingPage` is off).
	 * Reads view state rather than the view so deferred (not yet loaded) tabs count too.
	 */
	private findOpenFolderPage(folderPath: string): WorkspaceLeaf | null {
		if (!this.settings.focusExistingPage) return null;
		const path = normalizeFolderPath(folderPath);
		return (
			this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLDER_PAGE).find((leaf) => {
				const state = leaf.getViewState().state as Partial<FolderPageState> | undefined;
				return typeof state?.path === "string" && normalizeFolderPath(state.path) === path;
			}) ?? null
		);
	}

	private async focusLeaf(leaf: WorkspaceLeaf): Promise<void> {
		await this.app.workspace.revealLeaf(leaf);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	private getRightSidebarLeaf(): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const existing = workspace
			.getLeavesOfType(VIEW_TYPE_FOLDER_PAGE)
			.find((leaf) => leaf.getRoot() === workspace.rightSplit);
		return existing ?? workspace.getRightLeaf(false);
	}

	/**
	 * The folder the user is "in": the open folder page's folder, else the active note's
	 * folder, else the vault root.
	 */
	getCurrentFolderPath(): string {
		const view = this.app.workspace.getActiveViewOfType(FolderPageView);
		if (view) return view.getFolderPath();
		return normalizeFolderPath(this.app.workspace.getActiveFile()?.parent?.path ?? "");
	}

	async openTemplatePicker(folderPath: string): Promise<void> {
		const groups = await this.store.listAllTemplateGroups(folderPath);
		if (groups.length === 0) {
			new Notice("No templates for this folder or its parents.");
			return;
		}
		new TemplatePickerModal(this.app, folderPath, groups, (template) => {
			void this.createNoteFromTemplate(template, folderPath);
		}).open();
	}

	async createNoteFromTemplate(template: FolderTemplate, folderPath: string): Promise<void> {
		try {
			await this.noteCreator.createFromTemplate(template, folderPath);
		} catch (err) {
			console.error("[smart-folders] Failed to create note from template", err);
			new Notice(`Couldn't create note from "${template.name}". See console for details.`);
		}
	}

	/** Create (if needed) and reveal a folder's .osf/templates/ in the OS file manager. */
	async openTemplatesFolder(folderPath: string): Promise<void> {
		const dir = await this.store.ensureTemplatesDir(folderPath);
		if (!(await openInSystemExplorer(this.app, dir))) {
			new Notice(`Couldn't open the templates folder here. Its location in the vault is ${dir}`);
		}
	}

	/**
	 * Settings → "Remove all Smart Folders data": find every folder's .osf/, confirm, trash them.
	 * Plugin settings (data.json) go away when the plugin is uninstalled, so they're left alone.
	 */
	async removeAllData(): Promise<void> {
		const allFolders = this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder)
			.map((f) => f.path);
		const folders = await this.store.findOsfFolders(allFolders);
		if (folders.length === 0) {
			new Notice("No Smart Folders data found in this vault.");
			return;
		}
		if (!(await new ConfirmRemoveDataModal(this.app, folders).ask())) return;
		const { removed, failed } = await this.store.removeOsf(folders);
		this.refreshFolderPages();
		new Notice(
			`Moved Smart Folders data of ${removed.length} folder${removed.length === 1 ? "" : "s"} to the trash.` +
				(failed.length > 0 ? ` Couldn't remove: ${failed.map((f) => f || "/").join(", ")}` : ""),
		);
	}

	/** Re-render every open folder page (e.g. after a display setting changes). */
	refreshFolderPages(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLDER_PAGE)) {
			if (leaf.view instanceof FolderPageView) void leaf.view.render();
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<SmartFoldersSettings>);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

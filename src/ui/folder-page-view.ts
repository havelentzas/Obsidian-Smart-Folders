/**
 * The folder page: a workspace view showing one folder's
 *   1. Properties  — edit .osf/frontmatter.yaml
 *   2. Subfolders  — direct child folders (click to open their page)
 *   3. Templates   — files in .osf/templates/
 *
 * View state is `{ path: string }` (vault-relative folder path, "" or "/" = root),
 * so Obsidian can restore it across restarts.
 *
 * Stays live: follows its folder (or an ancestor) being renamed/moved, shows an empty state
 * if it is deleted, and redraws Subfolders when children change. These partial updates never
 * touch the Properties card, so unsaved YAML edits survive.
 *
 * UI only: all .osf IO goes through OsfStore.
 */

import { Events, ItemView, Notice, TAbstractFile, TFolder, ViewStateResult, WorkspaceLeaf, setIcon } from "obsidian";
import { FOLDER_PAGE_ICON, VIEW_TYPE_FOLDER_PAGE } from "../constants";
import { FrontmatterParseError } from "../core/frontmatter";
import { renamedPath } from "../core/folder-links";
import { ancestorsOf, basename, isInsideOsf, normalizeFolderPath, parentPath } from "../core/paths";
import type { FolderFrontmatter, FolderTemplate } from "../core/types";
import { createNativePropertiesEditor, type NativePropertiesEditor } from "../integrations/native-properties";
import type { OsfStore } from "../services/osf-store";

export interface FolderPageState extends Record<string, unknown> {
	path: string;
}

export interface FolderPageDeps {
	store: OsfStore;
	openFolderPage: (path: string) => Promise<void>;
	createNoteFromTemplate: (template: FolderTemplate, folderPath: string) => Promise<void>;
	openTemplatesFolder: (folderPath: string) => Promise<void>;
	/** Settings toggle: true = raw YAML textarea, false = Obsidian's native properties editor. */
	useRawYaml: () => boolean;
}

export class FolderPageView extends ItemView {
	private folderPath = "";
	/** Templates card body, re-rendered on its own (e.g. on window focus) so property edits aren't lost. */
	private templatesEl: HTMLElement | null = null;
	/** Incremented per render; stale async renders bail out instead of appending duplicates. */
	private renderId = 0;
	/** Native properties editor child component; replaced on every render. */
	private propertiesEditor: NativePropertiesEditor | null = null;
	/** Raw YAML mode: the textarea and the text last loaded/saved (to tell if the user has edits). */
	private yamlInput: { el: HTMLTextAreaElement; saved: string } | null = null;
	/** Header and Subfolders slots, redrawn on their own when the vault changes. */
	private headerEl: HTMLElement | null = null;
	private subfoldersEl: HTMLElement | null = null;
	/** Pending partial redraws, batched (a folder move fires one event per descendant). */
	private pending = { header: false, subfolders: false, templates: false, missing: false };
	private flushTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: FolderPageDeps,
	) {
		super(leaf);
	}

	/** Normalised path of the folder this page shows ("" = root). */
	getFolderPath(): string {
		return this.folderPath;
	}

	getViewType(): string {
		return VIEW_TYPE_FOLDER_PAGE;
	}

	getDisplayText(): string {
		return basename(this.folderPath) || this.app.vault.getName();
	}

	getIcon(): string {
		return FOLDER_PAGE_ICON;
	}

	getState(): Record<string, unknown> {
		const state: FolderPageState = { path: this.folderPath };
		return state;
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const path = (state as Partial<FolderPageState> | null)?.path;
		if (typeof path === "string") this.folderPath = normalizeFolderPath(path);
		await super.setState(state, result);
		await this.render();
	}

	async onOpen(): Promise<void> {
		// Templates are usually added in Finder; Obsidian fires no events for dot-folders,
		// so refresh the list whenever the window regains focus.
		this.registerDomEvent(window, "focus", () => void this.refreshTemplates());
		const { vault } = this.app;
		this.registerEvent(vault.on("rename", (file, oldPath) => this.onVaultRename(file, oldPath)));
		this.registerEvent(vault.on("create", (file) => this.onChildChanged(file, file.path)));
		this.registerEvent(vault.on("delete", (file) => this.onVaultDelete(file)));
		// Properties changed elsewhere (API, another folder page, Finder edit picked up on focus).
		this.registerEvent(
			// Custom event: Workspace's typed overloads don't cover it, the base Events signature does.
			(this.app.workspace as Events).on("smart-folders:properties-changed", (path: unknown, fm: unknown) => {
				if (path === this.folderPath) void this.syncProperties(fm as FolderFrontmatter | null);
			}),
		);
		await this.render();
	}

	async onClose(): Promise<void> {
		if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
		this.contentEl.empty();
	}

	// ── keeping the page live ──────────────────────────────────────────

	private onVaultRename(file: TAbstractFile, oldPath: string): void {
		if (!(file instanceof TFolder)) return;
		const moved = this.folderPath === "" ? null : renamedPath(this.folderPath, oldPath, file.path);
		if (moved !== null && moved !== this.folderPath) {
			this.folderPath = moved;
			// Header shows the name and ancestors; inherited template groups are labelled by ancestor.
			this.schedule({ header: true, templates: true });
		}
		this.onChildChanged(file, oldPath);
		this.onChildChanged(file, file.path);
	}

	private onVaultDelete(file: TAbstractFile): void {
		if (!(file instanceof TFolder)) return;
		if (this.folderPath !== "" && renamedPath(this.folderPath, file.path, file.path) !== null) {
			this.schedule({ missing: true });
			return;
		}
		this.onChildChanged(file, file.path);
	}

	/** A folder appeared at / disappeared from `path`; redraw Subfolders if it's a direct child. */
	private onChildChanged(file: TAbstractFile, path: string): void {
		if (file instanceof TFolder && parentPath(path) === this.folderPath) this.schedule({ subfolders: true });
	}

	private schedule(parts: Partial<typeof this.pending>): void {
		Object.assign(this.pending, parts);
		if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
		this.flushTimer = window.setTimeout(() => this.flush(), 50);
	}

	private flush(): void {
		this.flushTimer = null;
		const { header, subfolders, templates, missing } = this.pending;
		this.pending = { header: false, subfolders: false, templates: false, missing: false };
		const folder = this.getFolder();
		if (missing || !folder) {
			void this.render();
			return;
		}
		if (header) {
			this.redrawHeader();
			(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.(); // tab title (private)
			this.app.workspace.requestSaveLayout(); // persist the new path in view state
		}
		if (subfolders) this.redrawSubfolders(folder);
		if (templates) void this.refreshTemplates();
	}

	/** Show changed properties without a re-render; raw YAML with unsaved edits is left alone. */
	private async syncProperties(fm: FolderFrontmatter | null): Promise<void> {
		if (this.propertiesEditor) {
			this.propertiesEditor.synchronize(fm ?? {});
			return;
		}
		const input = this.yamlInput;
		if (!input || input.el.value !== input.saved) return;
		const text = await this.deps.store.readFrontmatterText(this.folderPath);
		if (this.yamlInput === input && input.el.value === input.saved) {
			input.el.value = text;
			input.saved = text;
		}
	}

	private redrawHeader(): void {
		const slot = this.headerEl;
		if (!slot) return;
		slot.empty();
		this.renderHeader(slot);
	}

	private redrawSubfolders(folder: TFolder): void {
		const slot = this.subfoldersEl;
		if (!slot) return;
		slot.empty();
		this.renderSubfolders(slot, folder);
	}

	private getFolder(): TFolder | null {
		if (this.folderPath === "") return this.app.vault.getRoot();
		const f = this.app.vault.getAbstractFileByPath(this.folderPath);
		return f instanceof TFolder ? f : null;
	}

	async render(): Promise<void> {
		const id = ++this.renderId;
		const root = this.contentEl;
		root.empty();
		root.addClass("smart-folders-page");
		this.templatesEl = null;
		this.headerEl = null;
		this.subfoldersEl = null;
		this.yamlInput = null;
		if (this.propertiesEditor) {
			this.removeChild(this.propertiesEditor);
			this.propertiesEditor = null;
		}

		const folder = this.getFolder();
		if (!folder) {
			root.createDiv({
				cls: "smart-folders-muted",
				text: `The folder "${this.folderPath || "/"}" no longer exists. It may have been deleted.`,
			});
			return;
		}

		this.headerEl = root.createDiv();
		this.renderHeader(this.headerEl);
		await this.renderProperties(root, id);
		if (id !== this.renderId) return;
		this.subfoldersEl = root.createDiv();
		this.renderSubfolders(this.subfoldersEl, folder);
		this.templatesEl = root.createDiv();
		await this.refreshTemplates();
	}

	// ── building blocks ────────────────────────────────────────────────

	private createCard(parent: HTMLElement, icon: string, title: string, count?: number): HTMLElement {
		const card = parent.createDiv({ cls: "smart-folders-card" });
		const header = card.createDiv({ cls: "smart-folders-card-header" });
		setIcon(header.createSpan({ cls: "smart-folders-card-icon" }), icon);
		header.createEl("h2", { text: title, cls: "smart-folders-card-title" });
		if (count !== undefined) header.createSpan({ cls: "smart-folders-badge", text: String(count) });
		return card;
	}

	private createTile(parent: HTMLElement, icon: string, label: string, onClick: () => void, hint?: string): HTMLElement {
		const tile = parent.createEl("button", { cls: "smart-folders-tile" });
		setIcon(tile.createSpan({ cls: "smart-folders-tile-icon" }), icon);
		tile.createSpan({ cls: "smart-folders-tile-label", text: label });
		if (hint) tile.createSpan({ cls: "smart-folders-tile-hint", text: hint });
		tile.addEventListener("click", onClick);
		return tile;
	}

	private folderLabel(path: string): string {
		return basename(path) || this.app.vault.getName();
	}

	// ── sections ───────────────────────────────────────────────────────

	/** Breadcrumb trail (clickable ancestors) above an icon + folder title. */
	private renderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: "smart-folders-header" });
		const ancestors = ancestorsOf(this.folderPath).reverse();
		if (this.folderPath !== "") {
			const crumbs = header.createDiv({ cls: "smart-folders-breadcrumbs" });
			for (const path of ancestors) {
				const crumb = crumbs.createEl("a", { text: this.folderLabel(path), href: "#" });
				crumb.addEventListener("click", (evt) => {
					evt.preventDefault();
					void this.deps.openFolderPage(path);
				});
				crumbs.createSpan({ cls: "smart-folders-breadcrumb-sep", text: "/" });
			}
		}
		const titleRow = header.createDiv({ cls: "smart-folders-title-row" });
		setIcon(titleRow.createSpan({ cls: "smart-folders-title-icon" }), this.folderPath === "" ? "vault" : "folder-open");
		titleRow.createEl("h1", { text: this.getDisplayText(), cls: "smart-folders-title" });
	}

	/**
	 * Native editor by default (same UI, types and autofill as note properties); raw YAML if
	 * the setting asks for it, the YAML is invalid, or the native editor isn't available.
	 */
	private async renderProperties(root: HTMLElement, id: number): Promise<void> {
		const slot = root.createDiv();
		if (this.deps.useRawYaml()) return this.renderRawYaml(slot);

		let frontmatter: FolderFrontmatter;
		try {
			frontmatter = await this.deps.store.readFrontmatter(this.folderPath);
		} catch (err) {
			if (!(err instanceof FrontmatterParseError)) throw err;
			return this.renderRawYaml(slot, `This folder's properties aren't valid YAML, so they're shown as text. ${err.message}`);
		}
		if (id !== this.renderId) return;

		const editor = createNativePropertiesEditor({
			app: this.app,
			probeLeaf: this.leaf,
			hoverSource: VIEW_TYPE_FOLDER_PAGE,
			save: (data) => this.deps.store.writeFrontmatter(this.folderPath, data),
		});
		if (!editor) {
			return this.renderRawYaml(slot, "The native properties editor isn't available in this Obsidian version.");
		}
		this.propertiesEditor = editor;
		this.addChild(editor);
		slot.addClass("smart-folders-card", "smart-folders-properties-card");
		slot.appendChild(editor.containerEl);
		editor.synchronize(frontmatter);
	}

	private async renderRawYaml(slot: HTMLElement, notice?: string): Promise<void> {
		slot.addClass("smart-folders-card");
		const header = slot.createDiv({ cls: "smart-folders-card-header" });
		setIcon(header.createSpan({ cls: "smart-folders-card-icon" }), "code");
		header.createEl("h2", { text: "Properties (YAML)", cls: "smart-folders-card-title" });
		if (notice) slot.createDiv({ cls: "smart-folders-notice", text: notice });

		const textarea = slot.createEl("textarea", { cls: "smart-folders-yaml" });
		textarea.placeholder = "status: active\ntags:\n  - project";
		textarea.spellcheck = false;
		textarea.value = await this.deps.store.readFrontmatterText(this.folderPath);
		const input = { el: textarea, saved: textarea.value };
		this.yamlInput = input;

		const footer = slot.createDiv({ cls: "smart-folders-card-footer" });
		const errorEl = footer.createDiv({ cls: "smart-folders-error" });
		const saveBtn = footer.createEl("button", { text: "Save", cls: "mod-cta" });
		saveBtn.addEventListener("click", async () => {
			errorEl.setText("");
			try {
				const previous = input.saved;
				input.saved = textarea.value; // before the write: its change event must not reload the box
				try {
					await this.deps.store.writeFrontmatterText(this.folderPath, textarea.value);
				} catch (err) {
					input.saved = previous;
					throw err;
				}
				new Notice("Folder properties saved");
			} catch (err) {
				if (err instanceof FrontmatterParseError) errorEl.setText(err.message);
				else throw err;
			}
		});
	}

	private renderSubfolders(root: HTMLElement, folder: TFolder): void {
		const subfolders = folder.children
			.filter((c): c is TFolder => c instanceof TFolder && !isInsideOsf(c.path))
			.sort((a, b) => a.name.localeCompare(b.name));
		const card = this.createCard(root, "folder-tree", "Subfolders", subfolders.length);
		if (subfolders.length === 0) {
			card.createDiv({ cls: "smart-folders-muted", text: "No subfolders." });
			return;
		}
		const grid = card.createDiv({ cls: "smart-folders-grid" });
		for (const sub of subfolders) {
			this.createTile(grid, "folder", sub.name, () => void this.deps.openFolderPage(sub.path));
		}
	}

	/**
	 * Own templates, then inherited ones grouped by the ancestor they come from (nearest first).
	 * No own templates → a large "open templates folder" call to action; otherwise a small
	 * accented + button in the card header does the same.
	 */
	private async refreshTemplates(): Promise<void> {
		const host = this.templatesEl;
		if (!host) return;
		const own = await this.deps.store.listTemplates(this.folderPath);
		const inherited = await this.deps.store.listInheritedTemplates(this.folderPath);
		if (host !== this.templatesEl) return; // page re-rendered meanwhile
		host.empty();

		const card = this.createCard(host, "layout-template", "Templates", own.length);
		const openFolder = () => void this.deps.openTemplatesFolder(this.folderPath);

		if (own.length === 0) {
			const cta = card.createEl("button", { cls: "smart-folders-empty-cta" });
			setIcon(cta.createSpan({ cls: "smart-folders-empty-cta-icon" }), "plus");
			cta.createSpan({ cls: "smart-folders-empty-cta-title", text: "Open templates folder" });
			cta.createSpan({
				cls: "smart-folders-empty-cta-hint",
				text: "Any .md file you put there becomes a template for this folder and its subfolders.",
			});
			cta.addEventListener("click", openFolder);
		} else {
			const header = card.querySelector<HTMLElement>(".smart-folders-card-header");
			const addBtn = header?.createEl("button", {
				cls: "smart-folders-add-btn mod-cta",
				attr: { "aria-label": "Open templates folder" },
			});
			if (addBtn) {
				setIcon(addBtn, "plus");
				addBtn.addEventListener("click", openFolder);
			}
			this.renderTemplateGrid(card, own);
		}

		if (inherited.length === 0) return;
		card.createDiv({ cls: "smart-folders-subheader", text: "Inherited" });
		for (const group of inherited) {
			const groupEl = card.createDiv({ cls: "smart-folders-group" });
			const heading = groupEl.createEl("a", { cls: "smart-folders-group-heading", href: "#" });
			setIcon(heading.createSpan({ cls: "smart-folders-group-icon" }), "corner-left-up");
			heading.createSpan({ text: this.folderLabel(group.folderPath) });
			heading.addEventListener("click", (evt) => {
				evt.preventDefault();
				void this.deps.openFolderPage(group.folderPath);
			});
			this.renderTemplateGrid(groupEl, group.templates);
		}
	}

	/** Clicking a template creates a new note from it in THIS page's folder. */
	private renderTemplateGrid(parent: HTMLElement, templates: FolderTemplate[]): void {
		const grid = parent.createDiv({ cls: "smart-folders-grid" });
		for (const t of templates) {
			const tile = this.createTile(
				grid,
				"file-text",
				t.name,
				() => void this.deps.createNoteFromTemplate(t, this.folderPath),
				"New note",
			);
			tile.addClass("smart-folders-template-tile");
			tile.setAttr("aria-label", `New note from ${t.name}`);
		}
	}
}

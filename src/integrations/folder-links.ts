/**
 * [[Folder name]] links.
 *
 * Obsidian has no folder links, so we teach three internals about folders (all private API,
 * verified against 1.14.4 app.js — re-verify on upgrade):
 *
 *   metadataCache.isUnresolved(linkpath, source)
 *       Only used to style links. Folder links → "resolved", so they look like normal links
 *       in Live Preview, Source mode and Reading view.
 *   metadataCache.getLinkSuggestions()
 *       Feeds the native [[ autocomplete. Entries `{ file: null, path }` render as plain link
 *       text and insert as [[path]] — so folders appear in the native suggester.
 *   WorkspaceLeaf.prototype.openLinkText(linktext, source, state)
 *       Every link click (editor, reading view, graph) ends here. Unpatched, a missing target
 *       creates a new note; we open the folder page instead.
 *   internalPlugins "page-preview" instance.onLinkHover(hoverParent, targetEl, linktext, source)
 *       Called by core Page preview AFTER its modifier-key rules pass, so folder previews obey
 *       the same "require Ctrl/Cmd" settings as notes. Folder links get our folder preview.
 *   workspace.editorSuggest.suggests[*].renderSuggestion(item, el)
 *       The native [[ suggester (and friends) draw rows via a private helper; we decorate
 *       folder rows afterwards with a folder flair icon, like native alias rows get one.
 *
 * Notes always win: folders are only consulted when Obsidian found no file for the link.
 */

import { App, TFolder, WorkspaceLeaf, parseLinktext, setIcon, setTooltip, type HoverParent } from "obsidian";
import { FolderIndex, folderLinktext } from "../core/folder-links";
import { parentPath } from "../core/paths";
import { patchMethod } from "./patch";

interface LinkSuggestion {
	file: unknown;
	path: string;
	alias?: string;
}

interface InternalMetadataCache {
	isUnresolved(linkpath: string, sourcePath: string): boolean;
	getLinkSuggestions(): LinkSuggestion[];
}

export interface FolderLinksHost {
	app: App;
	isEnabled(): boolean;
	/** Open a folder page for a followed link. `leaf` is the tab Obsidian chose for the link. */
	openFolderFromLink(folderPath: string, leaf: WorkspaceLeaf): Promise<void>;
	/** Called when the set of folders changes (graph needs to recompute). */
	onFoldersChanged(): void;
	showFolderHover(hoverParent: HoverParent, targetEl: HTMLElement, folderPath: string): void;
	register(cb: () => void): void;
	registerEvent: (ref: ReturnType<App["vault"]["on"]>) => void;
}

export class FolderLinks {
	private index: FolderIndex | null = null;

	constructor(private readonly host: FolderLinksHost) {}

	install(): void {
		const { app } = this.host;
		const cache = app.metadataCache as unknown as InternalMetadataCache;
		const self = this;

		this.host.register(
			patchMethod(cache, "isUnresolved", (original) => function (this: unknown, linkpath: string, sourcePath: string) {
				const unresolved = original.call(this, linkpath, sourcePath) as boolean;
				return unresolved && self.resolve(linkpath) !== null ? false : unresolved;
			}),
		);

		this.host.register(
			patchMethod(cache, "getLinkSuggestions", (original) => function (this: unknown) {
				const suggestions = original.call(this) as LinkSuggestion[];
				return self.host.isEnabled() ? suggestions.concat(self.folderSuggestions(suggestions)) : suggestions;
			}),
		);

		this.host.register(
			patchMethod(WorkspaceLeaf.prototype, "openLinkText", (original) =>
				async function (this: WorkspaceLeaf, linktext: string, sourcePath: string, ...rest: unknown[]) {
					const { path } = parseLinktext(linktext);
					const isFile = app.metadataCache.getFirstLinkpathDest(path, sourcePath) !== null;
					const folder = isFile ? null : self.resolve(path);
					if (folder === null) return original.call(this, linktext, sourcePath, ...rest);
					await self.host.openFolderFromLink(folder, this);
				},
			),
		);

		app.workspace.onLayoutReady(() => {
			this.installHoverPreview();
			this.installSuggestionIcons();
		});

		const invalidate = (file: unknown) => {
			if (!(file instanceof TFolder)) return;
			this.index = null;
			this.host.onFoldersChanged();
		};
		this.host.registerEvent(app.vault.on("create", invalidate));
		this.host.registerEvent(app.vault.on("delete", invalidate));
		this.host.registerEvent(app.vault.on("rename", invalidate));
	}

	/** Current folder paths (excluding root) — post-rename when called from a rename handler. */
	folderPaths(): string[] {
		return this.getIndex().allPaths();
	}

	/** Folder a link targets once notes are ruled out (what a click on it would open), else null. */
	folderForLink(linkpath: string, sourcePath: string): string | null {
		if (this.host.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)) return null;
		return this.resolve(linkpath);
	}

	private installHoverPreview(): void {
		const internal = (this.host.app as unknown as {
			internalPlugins?: { getPluginById?(id: string): { instance?: object } | null };
		}).internalPlugins;
		const pagePreview = internal?.getPluginById?.("page-preview")?.instance;
		if (!pagePreview) return;
		const self = this;
		this.host.register(
			patchMethod(pagePreview, "onLinkHover", (original) =>
				function (this: unknown, hoverParent: HoverParent, targetEl: HTMLElement, linktext: string, sourcePath: string, ...rest: unknown[]) {
					const folder = self.folderForLink(parseLinktext(linktext ?? "").path, sourcePath ?? "");
					if (folder === null || !targetEl) return original.call(this, hoverParent, targetEl, linktext, sourcePath, ...rest);
					const current = hoverParent.hoverPopover as { targetEl?: HTMLElement } | null;
					if (current?.targetEl === targetEl) return; // already showing for this link
					self.host.showFolderHover(hoverParent, targetEl, folder);
				},
			),
		);
	}

	private installSuggestionIcons(): void {
		const suggests = (this.host.app.workspace as unknown as { editorSuggest?: { suggests?: object[] } }).editorSuggest
			?.suggests;
		const self = this;
		for (const suggest of suggests ?? []) {
			this.host.register(
				patchMethod(suggest, "renderSuggestion", (original) => function (this: unknown, item: unknown, el: HTMLElement) {
					const result = original.call(this, item, el);
					self.decorateSuggestion(item, el);
					return result;
				}),
			);
		}
	}

	/** Folder rows: folder flair icon (like native alias rows) + parent path as the note line. */
	private decorateSuggestion(item: unknown, el: HTMLElement): void {
		const s = item as Partial<LinkSuggestion> & { type?: string } | null;
		if (!this.host.isEnabled() || s?.type !== "linktext" || s.file || typeof s.path !== "string") return;
		const folder = this.folderForLink(parseLinktext(s.path).path, "");
		if (folder === null) return;
		el.addClass("smart-folders-folder-suggestion");
		const aux = el.querySelector<HTMLElement>(".suggestion-aux") ?? el.createDiv({ cls: "suggestion-aux" });
		const flair = aux.createSpan({ cls: "suggestion-flair" });
		setIcon(flair, "folder");
		setTooltip(flair, "Folder");
		const note = el.querySelector<HTMLElement>(".suggestion-note");
		const parent = parentPath(folder);
		if (note && !note.getText() && parent) note.setText(parent);
	}

	/** Folder a link path points to (null if disabled or no folder matches). Does NOT check notes. */
	resolve(linkpath: string): string | null {
		if (!this.host.isEnabled()) return null;
		return this.getIndex().resolve(linkpath);
	}

	private getIndex(): FolderIndex {
		this.index ??= new FolderIndex(
			this.host.app.vault
				.getAllLoadedFiles()
				.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
				.map((f) => f.path),
		);
		return this.index;
	}

	private folderSuggestions(existing: LinkSuggestion[]): LinkSuggestion[] {
		const { metadataCache } = this.host.app;
		const index = this.getIndex();
		const seen = new Set(existing.map((s) => s.path.toLowerCase()));
		const out: LinkSuggestion[] = [];
		for (const folder of index.allPaths()) {
			const text = folderLinktext(folder, index, (t) => metadataCache.getFirstLinkpathDest(t, "") !== null);
			if (seen.has(text.toLowerCase())) continue;
			seen.add(text.toLowerCase());
			out.push({ file: null, path: text });
		}
		return out;
	}
}

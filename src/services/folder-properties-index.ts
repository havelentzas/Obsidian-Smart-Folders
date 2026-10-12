/**
 * In-memory cache of every folder's properties (path → frontmatter), so synchronous callers
 * (Obsidian's suggestion getters, the public API) can read folder properties.
 *
 * Kept current by: a full rebuild (startup, window focus — .osf/ edits made outside Obsidian fire
 * no events), OsfStore change notifications (our own saves/removals), and folder rename/delete.
 * Every effective change is reported to `onChange` listeners, once per affected folder
 * (rebuilds are diffed, so an unchanged folder is not reported). Derived suggestion data is
 * memoised per version.
 */

import { collectPropertyInfos, collectValuesForKey, countTags, type PropertyInfo } from "../core/folder-properties";
import { renamedPath } from "../core/folder-links";
import { normalizeFolderPath } from "../core/paths";
import type { FolderFrontmatter } from "../core/types";
import type { OsfStore } from "./osf-store";

/** `frontmatter` null = the folder no longer has properties (cleared, removed, renamed away, deleted). */
export type FolderPropertiesListener = (folderPath: string, frontmatter: FolderFrontmatter | null) => void;

export class FolderPropertiesIndex {
	private readonly byFolder = new Map<string, FolderFrontmatter>();
	private readonly listeners: FolderPropertiesListener[] = [];
	private version = 0;
	private memo: { version: number; tags?: Record<string, number>; props?: Record<string, PropertyInfo> } = { version: -1 };
	private rebuilding: Promise<void> | null = null;
	private loaded = false;
	private readonly readyPromise: Promise<void>;
	private markReady: () => void = () => {};

	constructor(private readonly store: OsfStore) {
		this.readyPromise = new Promise((resolve) => (this.markReady = resolve));
		// null = that folder's .osf/ was removed; its subfolders keep theirs.
		store.onFrontmatterChange((path, fm) => this.set(path, fm ?? {}));
	}

	onChange(listener: FolderPropertiesListener): () => void {
		this.listeners.push(listener);
		return () => this.listeners.splice(this.listeners.indexOf(listener) >>> 0, 1);
	}

	/** True once the first rebuild has finished. */
	isReady(): boolean {
		return this.loaded;
	}

	whenReady(): Promise<void> {
		return this.readyPromise;
	}

	/** Re-read every folder's frontmatter. Folders with missing or invalid YAML are left out. */
	rebuild(folderPaths: string[]): Promise<void> {
		this.rebuilding ??= this.doRebuild(folderPaths).finally(() => (this.rebuilding = null));
		return this.rebuilding;
	}

	private async doRebuild(folderPaths: string[]): Promise<void> {
		const next = new Map<string, FolderFrontmatter>();
		for (const path of await this.store.findOsfFolders(folderPaths)) {
			try {
				const fm = await this.store.readFrontmatter(path);
				if (Object.keys(fm).length > 0) next.set(path, fm);
			} catch {
				// Invalid YAML: the folder page shows the error; nothing to suggest.
			}
		}
		const changes: [string, FolderFrontmatter | null][] = [];
		for (const [path, fm] of next) if (!sameData(this.byFolder.get(path), fm)) changes.push([path, fm]);
		for (const path of this.byFolder.keys()) if (!next.has(path)) changes.push([path, null]);
		this.byFolder.clear();
		for (const [path, fm] of next) this.byFolder.set(path, fm);
		if (changes.length > 0) this.version++;
		const first = !this.loaded;
		this.loaded = true;
		if (first) this.markReady(); // initial load: no per-folder change events
		else this.emit(changes);
	}

	get(folderPath: string): FolderFrontmatter | null {
		return this.byFolder.get(normalizeFolderPath(folderPath)) ?? null;
	}

	/** Folders that currently have at least one property. */
	folders(): string[] {
		return [...this.byFolder.keys()];
	}

	set(folderPath: string, fm: FolderFrontmatter): void {
		const path = normalizeFolderPath(folderPath);
		const empty = Object.keys(fm).length === 0;
		if (empty ? !this.byFolder.has(path) : sameData(this.byFolder.get(path), fm)) return;
		if (empty) this.byFolder.delete(path);
		else this.byFolder.set(path, fm);
		this.version++;
		this.emit([[path, empty ? null : fm]]);
	}

	/** Drop a folder and everything under it (folder deleted). */
	delete(folderPath: string): void {
		const path = normalizeFolderPath(folderPath);
		const gone = [...this.byFolder.keys()].filter((key) => renamedPath(key, path, path) !== null);
		if (gone.length === 0) return;
		for (const key of gone) this.byFolder.delete(key);
		this.version++;
		this.emit(gone.map((key) => [key, null]));
	}

	/** Re-key a renamed/moved folder and its descendants (.osf/ moves with the folder). */
	rename(oldPath: string, newPath: string): void {
		const moved: { from: string; to: string; fm: FolderFrontmatter }[] = [];
		for (const [key, fm] of this.byFolder) {
			const to = renamedPath(key, oldPath, newPath);
			if (to !== null && to !== key) moved.push({ from: key, to, fm });
		}
		if (moved.length === 0) return;
		for (const m of moved) this.byFolder.delete(m.from);
		for (const m of moved) this.byFolder.set(m.to, m.fm);
		this.version++;
		this.emit(moved.flatMap((m): [string, FolderFrontmatter | null][] => [[m.from, null], [m.to, m.fm]]));
	}

	propertyInfos(): Record<string, PropertyInfo> {
		this.fresh();
		return (this.memo.props ??= collectPropertyInfos(this.byFolder.values()));
	}

	tagCounts(): Record<string, number> {
		this.fresh();
		return (this.memo.tags ??= countTags(this.byFolder.values()));
	}

	valuesForKey(key: string): string[] {
		return collectValuesForKey(this.byFolder.values(), key);
	}

	private fresh(): void {
		if (this.memo.version !== this.version) this.memo = { version: this.version };
	}

	private emit(changes: [string, FolderFrontmatter | null][]): void {
		for (const [path, fm] of changes) {
			for (const listener of [...this.listeners]) {
				try {
					listener(path, fm);
				} catch (err) {
					console.error("[smart-folders] folder properties listener failed", err);
				}
			}
		}
	}
}

function sameData(a: FolderFrontmatter | undefined, b: FolderFrontmatter): boolean {
	return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

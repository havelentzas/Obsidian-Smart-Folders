/**
 * Folder link resolution + graph data transform. NO obsidian imports — unit-tested.
 *
 * Link rules ([[...]] link paths, with #subpath / |alias already stripped by the caller):
 *   - Notes always win: callers only consult this AFTER Obsidian found no file.
 *   - A trailing "/" (e.g. [[Projects/]]) is the explicit "this is a folder" signal.
 *   - Exact folder path match (case-insensitive) first, e.g. [[Projects/Work]].
 *   - Otherwise match by folder name; if several folders share it, the shallowest wins,
 *     then alphabetical — suggestions insert the full path when a name is ambiguous.
 */

import { basename, normalizeFolderPath } from "./paths";

export class FolderIndex {
	private readonly byPath = new Map<string, string>();
	private readonly byName = new Map<string, string[]>();

	/** `folderPaths`: every folder in the vault except the root. */
	constructor(folderPaths: Iterable<string>) {
		for (const raw of folderPaths) {
			const path = normalizeFolderPath(raw);
			if (path === "") continue;
			this.byPath.set(path.toLowerCase(), path);
			const name = basename(path).toLowerCase();
			const list = this.byName.get(name) ?? [];
			list.push(path);
			this.byName.set(name, list);
		}
		for (const list of this.byName.values()) list.sort(compareShallowFirst);
	}

	/** Folder path a link path points to, or null. */
	resolve(linkpath: string): string | null {
		const p = normalizeFolderPath(linkpath.trim());
		if (p === "") return null;
		const exact = this.byPath.get(p.toLowerCase());
		if (exact) return exact;
		if (p.includes("/")) return null;
		return this.byName.get(p.toLowerCase())?.[0] ?? null;
	}

	/** True if more than one folder has this folder's name. */
	isNameAmbiguous(folderPath: string): boolean {
		return (this.byName.get(basename(folderPath).toLowerCase())?.length ?? 0) > 1;
	}

	allPaths(): string[] {
		return [...this.byPath.values()];
	}
}

function compareShallowFirst(a: string, b: string): number {
	const depth = (p: string) => p.split("/").length;
	return depth(a) - depth(b) || a.localeCompare(b);
}

/**
 * Text to put inside [[...]] for a folder: its name if that is unambiguous, else its path;
 * plus a trailing "/" if a note would otherwise win that link.
 */
export function folderLinktext(folderPath: string, index: FolderIndex, noteResolves: (linktext: string) => boolean): string {
	const text = index.isNameAmbiguous(folderPath) ? folderPath : basename(folderPath);
	return noteResolves(text) ? `${text}/` : text;
}

// ── Graph ───────────────────────────────────────────────────────────────

/** Shape of Obsidian's graph renderer data (internal; verified against 1.14.4). */
export interface GraphNode {
	type: string;
	links: Record<string, boolean>;
	color?: { a: number; rgb: number };
}
export interface GraphData {
	nodes: Record<string, GraphNode>;
	[key: string]: unknown;
}

export interface FolderGraphOptions {
	/** metadataCache.unresolvedLinks: source note path → { linktext: count }. */
	unresolvedLinks: Record<string, Record<string, number>>;
	resolve: (linktext: string) => string | null;
	/** Add folder nodes (the graph "Folders" toggle). If false, folder links are just dropped. */
	showFolders: boolean;
	folderColor: { a: number; rgb: number };
}

/**
 * Node id for a folder: its path. Obsidian labels nodes with the last path segment, so this
 * shows the folder name. Can't collide with notes (ids end in an extension); if it equals an
 * "unresolved" node id, that node is the same link and gets replaced.
 */
export function folderNodeId(folderPath: string): string {
	return folderPath;
}

/**
 * Rewrites graph data: links from notes to folders become edges to folder nodes, and the
 * "unresolved" nodes Obsidian created for those links are removed (a folder isn't a missing note).
 * Mutates and returns `data`.
 */
export function applyFolderNodes(data: GraphData, opts: FolderGraphOptions): GraphData {
	const { nodes } = data;
	const folderLinktexts = new Set<string>();

	for (const [source, node] of Object.entries(nodes)) {
		if (node.type === "unresolved" || node.type === "tag") continue;
		const unresolved = opts.unresolvedLinks[source];
		if (!unresolved) continue;
		for (const linktext of Object.keys(unresolved)) {
			const folder = opts.resolve(linktext);
			if (!folder) continue;
			folderLinktexts.add(linktext);
			delete node.links[linktext];
			if (!opts.showFolders) continue;
			const id = folderNodeId(folder);
			node.links[id] = true;
			if (nodes[id]?.type !== "") nodes[id] = { type: "", links: nodes[id]?.links ?? {}, color: opts.folderColor };
		}
	}

	if (folderLinktexts.size > 0) {
		const stillLinked = new Set<string>();
		for (const node of Object.values(nodes)) for (const target of Object.keys(node.links)) stillLinked.add(target);
		for (const linktext of folderLinktexts) {
			if (nodes[linktext]?.type === "unresolved" && !stillLinked.has(linktext)) delete nodes[linktext];
		}
	}
	return data;
}

// ── Folder renames ──────────────────────────────────────────────────────

/** Where `target` lives after `oldPath` was renamed to `newPath`, or null if unaffected. */
export function renamedPath(target: string, oldPath: string, newPath: string): string | null {
	if (target === oldPath) return newPath;
	if (target.startsWith(`${oldPath}/`)) return newPath + target.slice(oldPath.length);
	return null;
}

/** Reconstruct the pre-rename folder list from the post-rename one. */
export function foldersBeforeRename(currentPaths: string[], oldPath: string, newPath: string): string[] {
	return currentPaths.map((p) => renamedPath(p, newPath, oldPath) ?? p);
}

export interface LinkRewriteContext {
	before: FolderIndex;
	after: FolderIndex;
	oldPath: string;
	newPath: string;
	/** True if a NOTE would resolve this link text after the rename (then a trailing "/" is needed). */
	noteResolves: (linktext: string) => boolean;
}

/**
 * New link path for a folder link affected by a rename, or null if the link doesn't change.
 * Keeps the link's style: name-only links stay name-only when the new name is unambiguous;
 * path links stay paths; a trailing "/" is kept (or added if a note now owns the name).
 */
export function rewriteFolderLinkpath(linkpath: string, ctx: LinkRewriteContext): string | null {
	const oldTarget = ctx.before.resolve(linkpath);
	if (!oldTarget) return null;
	const target = renamedPath(oldTarget, ctx.oldPath, ctx.newPath);
	if (!target) return null;

	const trimmed = linkpath.trim();
	const hadSlash = trimmed.endsWith("/");
	const nameOnly = !normalizeFolderPath(trimmed).includes("/");
	let text = nameOnly && !ctx.after.isNameAmbiguous(target) ? basename(target) : target;
	if (ctx.after.resolve(text) !== target) text = target;
	if (hadSlash || ctx.noteResolves(text)) text += "/";
	return text === trimmed ? null : text;
}

/**
 * Replace the link path inside a link's original source text. Supports wikilinks
 * (`[[path#sub|alias]]`, `![[...]]`) and markdown links (`[text](path%20x#sub)`).
 * Returns null if `oldLinkpath` isn't where expected.
 */
export function replaceLinkpath(original: string, oldLinkpath: string, newLinkpath: string): string | null {
	const wiki = original.match(/^(!?\[\[)(.*)$/s);
	if (wiki) {
		const [, open = "", rest = ""] = wiki;
		return rest.startsWith(oldLinkpath) ? open + newLinkpath + rest.slice(oldLinkpath.length) : null;
	}
	const md = original.match(/^(!?\[[^\]]*\]\()(<?)([^)>]*?)(>?\))$/s);
	if (md) {
		const [, head = "", lt = "", url = "", tail = ""] = md;
		let decoded: string;
		try {
			decoded = decodeURI(url);
		} catch {
			return null;
		}
		if (!decoded.startsWith(oldLinkpath)) return null;
		const encode = (s: string) => (lt ? s : s.replace(/ /g, "%20"));
		return head + lt + encode(newLinkpath) + url.slice(encode(oldLinkpath).length) + tail;
	}
	return null;
}

export interface TextEdit {
	/** Offsets from the metadata cache (may be slightly stale). */
	start: number;
	end: number;
	original: string;
	replacement: string;
}

/**
 * Apply edits to file text, last first. If the text at an edit's offsets no longer matches its
 * `original` (another writer shifted it), look for `original` nearby; skip the edit if not found.
 */
export function applyTextEdits(text: string, edits: TextEdit[]): { text: string; applied: number } {
	let out = text;
	let applied = 0;
	for (const e of [...edits].sort((a, b) => b.start - a.start)) {
		let start = out.slice(e.start, e.end) === e.original ? e.start : -1;
		if (start === -1) start = nearestOccurrence(out, e.original, e.start, 500);
		if (start === -1) continue;
		out = out.slice(0, start) + e.replacement + out.slice(start + e.original.length);
		applied++;
	}
	return { text: out, applied };
}

/** Index of the occurrence of `needle` closest to `near` (within `radius`), or -1. */
function nearestOccurrence(text: string, needle: string, near: number, radius: number): number {
	let best = -1;
	for (let i = text.indexOf(needle, Math.max(0, near - radius)); i !== -1 && i <= near + radius; i = text.indexOf(needle, i + 1)) {
		if (best === -1 || Math.abs(i - near) < Math.abs(best - near)) best = i;
	}
	return best;
}

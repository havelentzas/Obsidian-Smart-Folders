import type { OsfFileSystem } from "../../src/core/types";

/** In-memory OsfFileSystem mimicking Obsidian's DataAdapter (vault-relative paths, full paths from list()). */
export class MemoryFs implements OsfFileSystem {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();

	constructor(initial: Record<string, string> = {}) {
		for (const [path, data] of Object.entries(initial)) {
			this.files.set(path, data);
			this.addParents(path);
		}
	}

	private addParents(path: string): void {
		const parts = path.split("/");
		for (let i = 1; i < parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path) || this.folders.has(path);
	}

	async read(path: string): Promise<string> {
		const data = this.files.get(path);
		if (data === undefined) throw new Error(`ENOENT: ${path}`);
		return data;
	}

	async write(path: string, data: string): Promise<void> {
		this.files.set(path, data);
		this.addParents(path);
	}

	async mkdir(path: string): Promise<void> {
		this.folders.add(path);
		this.addParents(path);
	}

	/** Paths passed to trash(), in order. A path in `failTrash` throws instead. */
	readonly trashed: string[] = [];
	readonly failTrash = new Set<string>();

	async trash(path: string): Promise<void> {
		if (this.failTrash.has(path) || !(await this.exists(path))) throw new Error(`cannot trash ${path}`);
		const inside = (p: string) => p === path || p.startsWith(path + "/");
		for (const f of [...this.files.keys()]) if (inside(f)) this.files.delete(f);
		for (const d of [...this.folders]) if (inside(d)) this.folders.delete(d);
		this.trashed.push(path);
	}

	async list(path: string): Promise<{ files: string[]; folders: string[] }> {
		const isChild = (p: string) => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/");
		return {
			files: [...this.files.keys()].filter(isChild),
			folders: [...this.folders].filter(isChild),
		};
	}
}

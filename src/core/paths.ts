/**
 * Pure path helpers for the .osf layout. NO obsidian imports — unit-tested.
 *
 * Layout for a folder at `<folder>`:
 *   <folder>/.osf/frontmatter.yaml   folder properties
 *   <folder>/.osf/templates/*.md     folder-specific templates
 *
 * The vault root is represented as "" or "/" (Obsidian uses "/" for the root TFolder).
 */

export const OSF_DIR = ".osf";
export const FRONTMATTER_FILE = "frontmatter.yaml";
export const TEMPLATES_DIR = "templates";

/** Normalise a vault-relative folder path: strip leading/trailing slashes; root becomes "". */
export function normalizeFolderPath(folderPath: string): string {
	return folderPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

export function joinPath(...parts: string[]): string {
	return parts.map(normalizeFolderPath).filter((p) => p.length > 0).join("/");
}

export function osfDirFor(folderPath: string): string {
	return joinPath(folderPath, OSF_DIR);
}

export function frontmatterPathFor(folderPath: string): string {
	return joinPath(folderPath, OSF_DIR, FRONTMATTER_FILE);
}

export function templatesDirFor(folderPath: string): string {
	return joinPath(folderPath, OSF_DIR, TEMPLATES_DIR);
}

/** True if any segment of the path is the .osf directory. */
export function isInsideOsf(path: string): boolean {
	return normalizeFolderPath(path).split("/").includes(OSF_DIR);
}

/** Last path segment; root returns "". */
export function basename(path: string): string {
	const parts = normalizeFolderPath(path).split("/");
	return parts[parts.length - 1] ?? "";
}

/** Parent folder path; root's children return "" (root). Root itself returns null. */
export function parentPath(folderPath: string): string | null {
	const p = normalizeFolderPath(folderPath);
	if (p === "") return null;
	const i = p.lastIndexOf("/");
	return i === -1 ? "" : p.slice(0, i);
}

/** All ancestor folders, nearest first, ending with the vault root (""). Root itself has none. */
export function ancestorsOf(folderPath: string): string[] {
	const out: string[] = [];
	for (let p = parentPath(folderPath); p !== null; p = parentPath(p)) out.push(p);
	return out;
}

/**
 * First free note path in a folder, Obsidian-style: "Untitled.md", "Untitled 1.md", ...
 * `exists` is injected so this stays pure.
 */
export function availableNotePath(folderPath: string, baseName: string, exists: (path: string) => boolean): string {
	for (let i = 0; ; i++) {
		const candidate = joinPath(folderPath, `${i === 0 ? baseName : `${baseName} ${i}`}.md`);
		if (!exists(candidate)) return candidate;
	}
}

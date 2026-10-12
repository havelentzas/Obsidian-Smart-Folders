/**
 * Reads and writes a folder's .osf/ contents. Depends only on the injected
 * OsfFileSystem + YamlCodec, so it is unit-tested with an in-memory fake.
 *
 * This is the ONLY module that touches .osf/ on disk. UI code calls this; it never
 * builds .osf paths or calls the adapter itself.
 */

import { parseFrontmatter, serializeFrontmatter } from "../core/frontmatter";
import { removeShadowedTemplates } from "../core/templates";
import { ancestorsOf, basename, frontmatterPathFor, normalizeFolderPath, osfDirFor, templatesDirFor } from "../core/paths";
import type { FolderFrontmatter, FolderTemplate, OsfFileSystem, TemplateGroup, YamlCodec } from "../core/types";

export type FrontmatterChangeListener = (folderPath: string, frontmatter: FolderFrontmatter | null) => void;

export class OsfStore {
	private readonly listeners: FrontmatterChangeListener[] = [];

	constructor(
		private readonly fs: OsfFileSystem,
		private readonly yaml: YamlCodec,
	) {}

	/** Called after this store writes a folder's properties (or null after removing its .osf/). */
	onFrontmatterChange(listener: FrontmatterChangeListener): void {
		this.listeners.push(listener);
	}

	private emit(folderPath: string, frontmatter: FolderFrontmatter | null): void {
		const path = normalizeFolderPath(folderPath);
		for (const listener of this.listeners) listener(path, frontmatter);
	}

	async hasOsf(folderPath: string): Promise<boolean> {
		return this.fs.exists(osfDirFor(folderPath));
	}

	/** Create .osf/ (and an empty frontmatter.yaml) if missing. Idempotent. */
	async ensureOsf(folderPath: string): Promise<void> {
		const dir = osfDirFor(folderPath);
		if (!(await this.fs.exists(dir))) await this.fs.mkdir(dir);
		const fm = frontmatterPathFor(folderPath);
		if (!(await this.fs.exists(fm))) await this.fs.write(fm, "");
	}

	/** Raw YAML text; "" if the file does not exist. */
	async readFrontmatterText(folderPath: string): Promise<string> {
		const fm = frontmatterPathFor(folderPath);
		return (await this.fs.exists(fm)) ? this.fs.read(fm) : "";
	}

	/** Parsed properties; {} if missing. Throws FrontmatterParseError on bad YAML. */
	async readFrontmatter(folderPath: string): Promise<FolderFrontmatter> {
		return parseFrontmatter(await this.readFrontmatterText(folderPath), this.yaml);
	}

	async writeFrontmatter(folderPath: string, frontmatter: FolderFrontmatter): Promise<void> {
		await this.ensureOsf(folderPath);
		await this.fs.write(frontmatterPathFor(folderPath), serializeFrontmatter(frontmatter, this.yaml));
		this.emit(folderPath, frontmatter);
	}

	/** Validate then write raw YAML text. Throws FrontmatterParseError without writing if invalid. */
	async writeFrontmatterText(folderPath: string, text: string): Promise<void> {
		const parsed = parseFrontmatter(text, this.yaml);
		await this.ensureOsf(folderPath);
		await this.fs.write(frontmatterPathFor(folderPath), text);
		this.emit(folderPath, parsed);
	}

	/** Create .osf/templates/ if missing (explicit user action only). Returns its vault path. */
	async ensureTemplatesDir(folderPath: string): Promise<string> {
		await this.ensureOsf(folderPath);
		const dir = templatesDirFor(folderPath);
		if (!(await this.fs.exists(dir))) await this.fs.mkdir(dir);
		return dir;
	}

	/** Templates in .osf/templates/, sorted by name. [] if the directory does not exist. */
	async listTemplates(folderPath: string): Promise<FolderTemplate[]> {
		const dir = templatesDirFor(folderPath);
		if (!(await this.fs.exists(dir))) return [];
		const { files } = await this.fs.list(dir);
		return files
			.filter((f) => f.toLowerCase().endsWith(".md"))
			.map((path) => ({ path, name: basename(path).replace(/\.md$/i, "") }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * The folder's own templates (first, if any) then each ancestor's, nearest first, root last.
	 * Shadowed templates are removed: a same-named template in a nearer folder wins.
	 */
	async listAllTemplateGroups(folderPath: string): Promise<TemplateGroup[]> {
		const chain = [normalizeFolderPath(folderPath), ...ancestorsOf(folderPath)];
		const raw: TemplateGroup[] = [];
		for (const path of chain) raw.push({ folderPath: path, templates: await this.listTemplates(path) });
		return removeShadowedTemplates(raw);
	}

	/** Inherited (ancestor) groups only, after shadowing by the folder's own and nearer templates. */
	async listInheritedTemplates(folderPath: string): Promise<TemplateGroup[]> {
		const self = normalizeFolderPath(folderPath);
		return (await this.listAllTemplateGroups(self)).filter((g) => g.folderPath !== self);
	}

	async readTemplate(template: FolderTemplate): Promise<string> {
		return this.fs.read(template.path);
	}

	/** Which of `folderPaths` have a .osf/ directory (normalized, input order, duplicates dropped). */
	async findOsfFolders(folderPaths: string[]): Promise<string[]> {
		const found: string[] = [];
		for (const path of new Set(folderPaths.map(normalizeFolderPath))) {
			if (await this.hasOsf(path)) found.push(path);
		}
		return found;
	}

	/**
	 * Trash the .osf/ of each folder (explicit user action only: "Remove all Smart Folders data").
	 * Keeps going past failures; returns the folders that could not be removed.
	 */
	async removeOsf(folderPaths: string[]): Promise<{ removed: string[]; failed: string[] }> {
		const removed: string[] = [];
		const failed: string[] = [];
		for (const path of folderPaths) {
			try {
				await this.fs.trash(osfDirFor(path));
				removed.push(path);
				this.emit(path, null);
			} catch {
				failed.push(path);
			}
		}
		return { removed, failed };
	}
}

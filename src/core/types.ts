/** Shared types. NO obsidian imports. */

/** A folder's properties — the parsed contents of .osf/frontmatter.yaml. Always a plain object. */
export type FolderFrontmatter = Record<string, unknown>;

/**
 * YAML codec injected into core code.
 * - In the plugin: Obsidian's `parseYaml` / `stringifyYaml`.
 * - In tests: the `yaml` npm package.
 */
export interface YamlCodec {
	parse(text: string): unknown;
	stringify(value: unknown): string;
}

/**
 * Minimal file-system surface the store needs. Obsidian's `DataAdapter`
 * (`app.vault.adapter`) backs it (see integrations/vault-fs.ts). Tests use an in-memory fake.
 *
 * We MUST go through the adapter, not `app.vault`, because Obsidian does not
 * index dot-folders: `.osf/` never appears as a TFolder/TFile.
 */
export interface OsfFileSystem {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	/** Move a file or folder (recursively) to the trash. Recoverable; never a hard delete. */
	trash(path: string): Promise<void>;
}

export interface FolderTemplate {
	/** Display name (file name without .md). */
	name: string;
	/** Vault-relative path to the template file inside .osf/templates/. */
	path: string;
}

/** Templates contributed by one folder (the open folder itself, or an ancestor). */
export interface TemplateGroup {
	/** Vault-relative path of the folder that owns these templates ("" = root). */
	folderPath: string;
	templates: FolderTemplate[];
}

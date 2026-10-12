/**
 * Smart Folders public API implementation (types and contract: ./types.ts, docs/API.md).
 * A thin, defensive facade over the plugin's services: validates input, returns copies, and
 * never exposes internal objects. Exposed as `plugin.api`.
 */

import type { App, TFile } from "obsidian";
import { TFolder } from "obsidian";
import { frontmatterPathFor, isInsideOsf, normalizeFolderPath, osfDirFor, templatesDirFor } from "../core/paths";
import type { FolderTemplate } from "../core/types";
import type { FolderPropertiesIndex } from "../services/folder-properties-index";
import type { OsfStore } from "../services/osf-store";
import {
	SMART_FOLDERS_API_VERSION,
	type FolderDataPaths,
	type FolderProperties,
	type FolderTemplateGroup,
	type FolderTemplateInfo,
	type SmartFoldersApi,
} from "./types";

export interface SmartFoldersApiDeps {
	app: App;
	pluginVersion: string;
	store: OsfStore;
	index: FolderPropertiesIndex;
	createNote(template: FolderTemplate, folderPath: string): Promise<TFile | null>;
	resolveFolderLink(linktext: string, sourcePath: string): string | null;
	openFolderPage(folderPath: string): Promise<void>;
}

export function createSmartFoldersApi(deps: SmartFoldersApiDeps): SmartFoldersApi {
	const { app, store, index } = deps;

	const folderExists = (path: string): boolean =>
		path === "" || app.vault.getAbstractFileByPath(path) instanceof TFolder;

	const requireFolder = (folderPath: string): string => {
		if (typeof folderPath !== "string") throw new TypeError("Smart Folders API: folderPath must be a string");
		const path = normalizeFolderPath(folderPath);
		if (!folderExists(path)) throw new Error(`Smart Folders API: no folder at "${folderPath}"`);
		return path;
	};

	const api: SmartFoldersApi = {
		apiVersion: SMART_FOLDERS_API_VERSION,
		pluginVersion: deps.pluginVersion,

		isReady: () => index.isReady(),
		whenReady: () => index.whenReady(),

		getFolderProperties(folderPath) {
			const path = normalizeFolderPath(folderPath);
			if (!folderExists(path)) return null;
			return structuredClone(index.get(path) ?? {});
		},

		getFoldersWithProperties: () => index.folders(),

		async setFolderProperties(folderPath, properties) {
			const path = requireFolder(folderPath);
			if (!isPlainObject(properties)) throw new TypeError("Smart Folders API: properties must be a plain object");
			await store.writeFrontmatter(path, structuredClone(properties));
		},

		async updateFolderProperties(folderPath, update) {
			const path = requireFolder(folderPath);
			const next = update(structuredClone(await store.readFrontmatter(path)));
			await api.setFolderProperties(path, next);
		},

		async getFolderTemplates(folderPath) {
			const path = requireFolder(folderPath);
			const groups = await store.listAllTemplateGroups(path);
			return groups.map(
				(g): FolderTemplateGroup => ({
					folderPath: g.folderPath,
					inherited: g.folderPath !== path,
					templates: g.templates.map((t) => ({ name: t.name, path: t.path })),
				}),
			);
		},

		async createNoteFromTemplate(template: FolderTemplateInfo, folderPath) {
			const path = requireFolder(folderPath);
			if (!template || typeof template.path !== "string" || !isInsideOsf(template.path) || !/\.md$/i.test(template.path)) {
				throw new TypeError("Smart Folders API: template must come from getFolderTemplates()");
			}
			return deps.createNote({ name: String(template.name ?? ""), path: template.path }, path);
		},

		resolveFolderLink: (linktext, sourcePath) => deps.resolveFolderLink(String(linktext ?? ""), String(sourcePath ?? "")),

		openFolderPage: (folderPath) => deps.openFolderPage(requireFolder(folderPath)),

		getFolderDataPaths(folderPath): FolderDataPaths {
			const path = normalizeFolderPath(folderPath);
			return { osfDir: osfDirFor(path), propertiesFile: frontmatterPathFor(path), templatesDir: templatesDirFor(path) };
		},
	};
	return Object.freeze(api);
}

function isPlainObject(value: unknown): value is FolderProperties {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value) as unknown;
	return proto === Object.prototype || proto === null;
}

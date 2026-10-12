/**
 * Folder properties in Obsidian's own suggestions: property names (and their inferred types),
 * property values, and tags. Obsidian builds these only from notes; we merge folder data in.
 *
 * Private API (verified against 1.14.4 app.js — re-verify on upgrade):
 *   metadataTypeManager.getAllProperties()            → { lowerName: { name, widget } }
 *       Property-name suggester, type icons, Bases, the "All properties" view.
 *   metadataCache.getFrontmatterPropertyValuesForKey(key) → string[]
 *       Value suggester for text/list properties.
 *   metadataCache.getTags()                           → { "#tag": count }
 *       Tag suggesters (`#` in the editor, the tags property) and the Tags view.
 *
 * Notes win: folder-only names are added, existing names keep Obsidian's type. Every patch is
 * a pass-through while the setting is off.
 */

import type { App } from "obsidian";
import { mergeMissing, mergeTagCounts, mergeValues, type PropertyInfo } from "../core/folder-properties";
import type { FolderPropertiesIndex } from "../services/folder-properties-index";
import { patchMethod } from "./patch";

export interface FolderPropertySuggestionsHost {
	app: App;
	index: FolderPropertiesIndex;
	isEnabled(): boolean;
	register(cb: () => void): void;
}

interface InternalTypeManager {
	getAllProperties(): Record<string, PropertyInfo>;
}

interface InternalMetadataCache {
	getFrontmatterPropertyValuesForKey(key: string): string[];
	getTags(): Record<string, number>;
}

export function installFolderPropertySuggestions(host: FolderPropertySuggestionsHost): void {
	const { app, index, isEnabled } = host;
	const typeManager = (app as unknown as { metadataTypeManager?: InternalTypeManager }).metadataTypeManager;
	const cache = app.metadataCache as unknown as InternalMetadataCache;

	if (typeManager) {
		// No memo: Obsidian adds keys to its object in place (e.g. on a type change), so merge
		// on every call. Cheap — and when no folder adds a name, `base` itself is returned.
		host.register(
			patchMethod(typeManager, "getAllProperties", (original) => function (this: unknown) {
				const base = original.call(this) as Record<string, PropertyInfo>;
				return isEnabled() ? mergeMissing(base, index.propertyInfos()) : base;
			}),
		);
	}

	host.register(
		patchMethod(cache, "getFrontmatterPropertyValuesForKey", (original) => function (this: unknown, key: string) {
			const base = original.call(this, key) as string[];
			return isEnabled() ? mergeValues(base, index.valuesForKey(key)) : base;
		}),
	);

	host.register(
		patchMethod(cache, "getTags", (original) => function (this: unknown) {
			const base = original.call(this) as Record<string, number>;
			return isEnabled() ? mergeTagCounts(base, index.tagCounts()) : base;
		}),
	);
}

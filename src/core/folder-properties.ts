/**
 * Folder properties as suggestion data, mirroring how Obsidian derives suggestions from notes
 * (read from 1.14.4 app.js): property names + inferred types, string values per key, and tag
 * counts. Pure, so the rules are unit-tested; integrations/folder-property-suggestions.ts
 * merges the results into Obsidian's own.
 */

import type { FolderFrontmatter } from "./types";

export interface PropertyInfo {
	name: string;
	widget: string;
}

const DATETIME = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/;
const DATE = /^\d{4}-[01]\d-[0-3]\d$/;

/** Property type Obsidian infers for a value it hasn't been told the type of. */
export function inferWidget(value: unknown): string {
	if (value === null || value === undefined) return "text";
	if (typeof value === "string") return DATETIME.test(value) ? "datetime" : DATE.test(value) ? "date" : "text";
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "checkbox";
	if (Array.isArray(value) && value.every((v) => typeof v === "string")) return "multitext";
	return "unknown";
}

/** Property names (keyed lower-case, first spelling wins) with the type of the first non-null value. */
export function collectPropertyInfos(frontmatters: Iterable<FolderFrontmatter>): Record<string, PropertyInfo> {
	const out: Record<string, PropertyInfo> = {};
	for (const fm of frontmatters) {
		for (const [name, value] of Object.entries(fm)) {
			const key = name.toLowerCase();
			const existing = out[key];
			if (!existing) out[key] = { name, widget: value == null ? "" : inferWidget(value) };
			else if (existing.widget === "" && value != null) existing.widget = inferWidget(value);
		}
	}
	for (const info of Object.values(out)) if (info.widget === "") info.widget = "text";
	return out;
}

/** String values used for `key` (exact key, like Obsidian): plain strings and string list items. */
export function collectValuesForKey(frontmatters: Iterable<FolderFrontmatter>, key: string): string[] {
	if (!key) return [];
	const out = new Set<string>();
	for (const fm of frontmatters) {
		if (!Object.hasOwn(fm, key)) continue;
		const value = fm[key];
		const items = Array.isArray(value) ? value : [value];
		for (const item of items) if (typeof item === "string" && item !== "") out.add(item);
	}
	return [...out];
}

/** A folder's tags as "#tag" (from a `tags` property, any case; list or single string). */
export function frontmatterTags(fm: FolderFrontmatter): string[] {
	const key = Object.keys(fm).find((k) => /^tags$/i.test(k));
	if (key === undefined) return [];
	const raw = fm[key];
	const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
	return list
		.map((t) => t.trim())
		.filter((t) => t !== "" && !t.includes(" "))
		.map((t) => (t.startsWith("#") ? t : `#${t}`));
}

/** Tag → use count, like metadataCache.getTags(): nested tags also count toward their parents. */
export function countTags(frontmatters: Iterable<FolderFrontmatter>): Record<string, number> {
	const counts: Record<string, number> = {};
	const add = (tag: string): void => {
		if (tag.endsWith("/")) tag = tag.slice(0, -1);
		if (tag.length < 2 || /^#\d+$/.test(tag)) return;
		counts[tag] = (counts[tag] ?? 0) + 1;
		const slash = tag.lastIndexOf("/");
		if (slash > 0) add(tag.slice(0, slash));
	};
	for (const fm of frontmatters) for (const tag of frontmatterTags(fm)) add(tag);
	return counts;
}

/** `extra` entries whose key `base` lacks (case-insensitive), added to a copy of `base`. */
export function mergeMissing<T>(base: Record<string, T>, extra: Record<string, T>): Record<string, T> {
	const seen = new Set(Object.keys(base).map((k) => k.toLowerCase()));
	const added = Object.entries(extra).filter(([k]) => !seen.has(k.toLowerCase()));
	return added.length === 0 ? base : { ...base, ...Object.fromEntries(added) };
}

/** Tag counts summed (keys compared exactly, as Obsidian does). */
export function mergeTagCounts(base: Record<string, number>, extra: Record<string, number>): Record<string, number> {
	if (Object.keys(extra).length === 0) return base;
	const out = { ...base };
	for (const [tag, n] of Object.entries(extra)) out[tag] = (out[tag] ?? 0) + n;
	return out;
}

/** Union of value lists, deduplicated, in Obsidian's natural sort order. */
export function mergeValues(base: string[], extra: string[]): string[] {
	if (extra.length === 0) return base;
	return [...new Set([...base, ...extra])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Template inheritance rules. NO obsidian imports — unit-tested. */

import type { TemplateGroup } from "./types";

/**
 * Nearest folder wins: given groups ordered nearest-first (the folder's own templates,
 * then parent, grandparent, ... root), drop any template whose name (case-insensitive)
 * already appeared in a nearer group. Groups left empty are removed.
 */
export function removeShadowedTemplates(groups: TemplateGroup[]): TemplateGroup[] {
	const seen = new Set<string>();
	const out: TemplateGroup[] = [];
	for (const group of groups) {
		const visible = group.templates.filter((t) => !seen.has(t.name.toLowerCase()));
		for (const t of group.templates) seen.add(t.name.toLowerCase());
		if (visible.length > 0) out.push({ ...group, templates: visible });
	}
	return out;
}

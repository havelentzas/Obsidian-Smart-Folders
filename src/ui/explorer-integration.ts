/**
 * Hooks folder clicks in the core File Explorer.
 *
 * Obsidian has no public "folder clicked" event, so we listen for clicks on
 * `.nav-folder-title[data-path]` elements. This relies on File Explorer DOM
 * class names — if a future Obsidian version breaks folder clicks, look here first.
 * We do NOT preventDefault, so the folder still expands/collapses normally.
 */

import type { Plugin } from "obsidian";

export function registerFolderClickHandler(
	plugin: Plugin,
	isEnabled: () => boolean,
	onFolderClick: (path: string) => void,
): void {
	plugin.registerDomEvent(document, "click", (evt: MouseEvent) => {
		if (!isEnabled()) return;
		const target = evt.target;
		if (!(target instanceof HTMLElement)) return;
		// Clicking the chevron should only toggle, not navigate.
		if (target.closest(".collapse-icon")) return;
		const title = target.closest<HTMLElement>(".nav-folder-title");
		const path = title?.dataset.path;
		if (path === undefined) return;
		onFolderClick(path);
	});
}

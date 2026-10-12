/**
 * Hover preview for folder links: a compact, read-only folder page (title, properties,
 * subfolders, template count) inside an Obsidian HoverPopover.
 */

import { App, HoverPopover, TFolder, setIcon, type HoverParent } from "obsidian";
import { isInsideOsf, parentPath } from "../core/paths";
import type { FolderFrontmatter } from "../core/types";
import type { OsfStore } from "../services/osf-store";

const MAX_SUBFOLDERS = 8;

export interface FolderHoverDeps {
	app: App;
	store: OsfStore;
	openFolderPage: (path: string) => Promise<void>;
}

export function showFolderHover(deps: FolderHoverDeps, hoverParent: HoverParent, targetEl: HTMLElement, folderPath: string): void {
	const folder = deps.app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) return;
	const popover = new HoverPopover(hoverParent, targetEl);
	const root = popover.hoverEl.createDiv({ cls: "smart-folders-hover" });
	void renderFolderHover(deps, root, folder);
}

async function renderFolderHover(deps: FolderHoverDeps, root: HTMLElement, folder: TFolder): Promise<void> {
	const header = root.createDiv({ cls: "smart-folders-hover-header" });
	setIcon(header.createSpan({ cls: "smart-folders-hover-icon" }), "folder-open");
	const titles = header.createDiv();
	const title = titles.createEl("a", { cls: "smart-folders-hover-title", text: folder.name, href: "#" });
	title.addEventListener("click", (evt) => {
		evt.preventDefault();
		void deps.openFolderPage(folder.path);
	});
	const parent = parentPath(folder.path);
	if (parent) titles.createDiv({ cls: "smart-folders-hover-path", text: parent });

	let frontmatter: FolderFrontmatter = {};
	try {
		frontmatter = await deps.store.readFrontmatter(folder.path);
	} catch {
		root.createDiv({ cls: "smart-folders-hover-muted", text: "Properties aren't valid YAML." });
	}
	renderProperties(root, frontmatter);

	const subfolders = folder.children
		.filter((c): c is TFolder => c instanceof TFolder && !isInsideOsf(c.path))
		.sort((a, b) => a.name.localeCompare(b.name));
	if (subfolders.length > 0) {
		const chips = root.createDiv({ cls: "smart-folders-hover-chips" });
		for (const sub of subfolders.slice(0, MAX_SUBFOLDERS)) {
			const chip = chips.createEl("a", { cls: "smart-folders-hover-chip", href: "#" });
			setIcon(chip.createSpan(), "folder");
			chip.createSpan({ text: sub.name });
			chip.addEventListener("click", (evt) => {
				evt.preventDefault();
				void deps.openFolderPage(sub.path);
			});
		}
		if (subfolders.length > MAX_SUBFOLDERS) {
			chips.createSpan({ cls: "smart-folders-hover-muted", text: `+${subfolders.length - MAX_SUBFOLDERS} more` });
		}
	}

	const templates = await deps.store.listTemplates(folder.path);
	const notes = folder.children.length - subfolders.length;
	root.createDiv({
		cls: "smart-folders-hover-footer",
		text: [plural(notes, "item"), plural(subfolders.length, "subfolder"), plural(templates.length, "template")].join(" · "),
	});
}

function renderProperties(root: HTMLElement, frontmatter: FolderFrontmatter): void {
	const entries = Object.entries(frontmatter);
	if (entries.length === 0) return;
	const list = root.createDiv({ cls: "smart-folders-hover-props" });
	for (const [key, value] of entries) {
		const row = list.createDiv({ cls: "smart-folders-hover-prop" });
		row.createDiv({ cls: "smart-folders-hover-prop-key", text: key });
		const valueEl = row.createDiv({ cls: "smart-folders-hover-prop-value" });
		if (Array.isArray(value)) {
			for (const v of value) {
				valueEl.createSpan({ cls: "smart-folders-hover-pill", text: key === "tags" ? `#${String(v)}` : formatValue(v) });
			}
		} else {
			valueEl.setText(formatValue(value));
		}
	}
}

function formatValue(value: unknown): string {
	if (value === null || value === undefined || value === "") return "—";
	if (typeof value === "boolean") return value ? "✓" : "✗";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}


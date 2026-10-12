/**
 * Folder nodes in the core Graph view (global "graph" and "localgraph"), plus a "Folders"
 * toggle in the graph's Filters panel next to Tags / Attachments.
 *
 * Private API (verified against 1.14.4 app.js — re-verify on upgrade):
 *   view.renderer.setData(data)  — the graph engine builds `{ nodes: { id: { type, links, color? } } }`
 *                                  from the metadata cache and hands it here. We wrap it and run
 *                                  core/applyFolderNodes on the data first.
 *   view.dataEngine.render()     — recompute + redraw (what native option toggles call).
 *   DOM: `.graph-control-section.mod-filter .tree-item-children` — where native filter toggles live.
 *
 * Clicking a folder node calls `openLinkText(folderPath)`, which FolderLinks routes to the folder page.
 */

import { App, Setting, WorkspaceLeaf } from "obsidian";
import { applyFolderNodes, type GraphData } from "../core/folder-links";
import { patchMethod } from "./patch";

const GRAPH_TYPES = ["graph", "localgraph"] as const;
type GraphType = (typeof GRAPH_TYPES)[number];

interface GraphViewLike {
	contentEl: HTMLElement;
	renderer?: { setData?: (data: GraphData) => void };
	dataEngine?: { render?: () => void };
}

export interface GraphFoldersHost {
	app: App;
	isEnabled(): boolean;
	resolve(linkpath: string): string | null;
	getShowFolders(type: GraphType): boolean;
	setShowFolders(type: GraphType, value: boolean): Promise<void>;
	register(cb: () => void): void;
	registerEvent: (ref: ReturnType<App["workspace"]["on"]>) => void;
}

const TOGGLE_CLASS = "smart-folders-graph-toggle";

export class GraphFolders {
	private readonly patched = new WeakSet<object>();
	private readonly live = new Set<GraphViewLike>();

	constructor(private readonly host: GraphFoldersHost) {}

	install(): void {
		const { workspace } = this.host.app;
		const scan = () => this.scan();
		workspace.onLayoutReady(scan);
		this.host.registerEvent(workspace.on("layout-change", scan));
		this.host.registerEvent(workspace.on("active-leaf-change", scan));
	}

	/** Recompute every open graph (folder set or settings changed). */
	refresh(): void {
		for (const view of this.live) {
			this.injectToggle(view);
			view.dataEngine?.render?.();
		}
	}

	private scan(): void {
		for (const type of GRAPH_TYPES) {
			for (const leaf of this.host.app.workspace.getLeavesOfType(type)) this.attach(leaf, type);
		}
	}

	private attach(leaf: WorkspaceLeaf, type: GraphType): void {
		const view = leaf.view as unknown as GraphViewLike;
		const renderer = view.renderer;
		if (!renderer || typeof renderer.setData !== "function" || this.patched.has(view)) return;
		this.patched.add(view);
		this.live.add(view);

		this.host.register(
			patchMethod(renderer, "setData", (original) => (data: GraphData) =>
				original.call(renderer, this.transform(data, type)),
			),
		);

		const observer = new MutationObserver(() => this.injectToggle(view, type));
		observer.observe(view.contentEl, { childList: true, subtree: true });
		this.host.register(() => observer.disconnect());
		(leaf.view as unknown as { register?: (cb: () => void) => void }).register?.(() => {
			observer.disconnect();
			this.live.delete(view);
		});

		this.injectToggle(view, type);
		view.dataEngine?.render?.();
	}

	private transform(data: GraphData, type: GraphType): GraphData {
		if (!this.host.isEnabled() || !data?.nodes) return data;
		return applyFolderNodes(data, {
			unresolvedLinks: this.host.app.metadataCache.unresolvedLinks,
			resolve: (t) => this.host.resolve(t),
			showFolders: this.host.getShowFolders(type),
			folderColor: readFolderColor(),
		});
	}

	private injectToggle(view: GraphViewLike, type?: GraphType): void {
		const resolvedType = type ?? this.typeOf(view);
		const section = view.contentEl.querySelector<HTMLElement>(".graph-control-section.mod-filter .tree-item-children");
		const existing = section?.querySelector(`.${TOGGLE_CLASS}`);
		if (!this.host.isEnabled() || !resolvedType) {
			existing?.remove();
			return;
		}
		if (!section || existing) return;
		new Setting(section)
			.setName("Folders")
			.setTooltip("Show folders that notes link to with [[Folder name]].")
			.setClass("mod-toggle")
			.setClass(TOGGLE_CLASS)
			.addToggle((toggle) =>
				toggle.setValue(this.host.getShowFolders(resolvedType)).onChange(async (value) => {
					await this.host.setShowFolders(resolvedType, value);
					this.refresh();
				}),
			);
	}

	private typeOf(view: GraphViewLike): GraphType | null {
		const t = (view as unknown as { getViewType?: () => string }).getViewType?.();
		return t === "graph" || t === "localgraph" ? t : null;
	}
}

/** Theme color for folder nodes: CSS var --smart-folders-graph-folder (see styles.css). */
function readFolderColor(): { a: number; rgb: number } {
	const probe = document.body.createDiv({ cls: "smart-folders-graph-folder-color" });
	const color = getComputedStyle(probe).color;
	probe.remove();
	const m = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
	if (!m) return { a: 1, rgb: 0xe0ac00 };
	const [r, g, b] = [m[1], m[2], m[3]].map((n) => Number(n));
	return { a: m[4] !== undefined ? Number(m[4]) : 1, rgb: ((r ?? 0) << 16) | ((g ?? 0) << 8) | (b ?? 0) };
}

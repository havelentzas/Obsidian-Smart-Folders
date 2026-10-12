/**
 * Reuse Obsidian's OWN properties editor (the one at the top of every note) for folders.
 *
 * Obsidian's MetadataEditor is not public API and its class is not exported. It is a
 * Component constructed as `new MetadataEditor(app, owner)`; we grab the constructor from
 * an existing MarkdownView's `metadataEditor` and pass our own `owner` that reads/writes
 * `.osf/frontmatter.yaml` instead of a note.
 *
 * Because it is the real editor, folders get exactly the native behaviour for free:
 * property types from `app.metadataTypeManager` (shared with notes — changing a type here
 * changes it vault-wide, as in a note), value/tag autofill from the metadata cache, the
 * type menu, drag-to-reorder, keyboard navigation, copy/paste, theme styling.
 *
 * Owner contract (reverse-engineered from Obsidian 1.14.4 app.js — re-verify on upgrade):
 *   getFile(), getHoverSource(), saveFrontmatter(data),
 *   focusAfterMetadata(), focusBeforeMetadata(), onMarkdownFold()
 * Editor surface we use: containerEl, synchronize(data | null), Component lifecycle.
 *
 * Everything is feature-checked; if it fails, `createNativePropertiesEditor` returns null
 * and the caller falls back to the raw YAML editor.
 */

import { App, Component, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import type { FolderFrontmatter } from "../core/types";

export interface NativePropertiesEditor extends Component {
	containerEl: HTMLElement;
	/** Replace displayed properties. Rows are reused by key; focused rows aren't clobbered. */
	synchronize(data: FolderFrontmatter | null): void;
}

export interface MetadataEditorOwner {
	getFile(): TFile | null;
	getHoverSource(): string;
	saveFrontmatter(data: FolderFrontmatter): void;
	focusAfterMetadata(): void;
	focusBeforeMetadata(): void;
	onMarkdownFold(): void;
}

type MetadataEditorCtor = new (app: App, owner: MetadataEditorOwner) => NativePropertiesEditor;

let cachedCtor: MetadataEditorCtor | null | undefined;

function ctorFromView(view: unknown): MetadataEditorCtor | null {
	const editor = (view as { metadataEditor?: { constructor?: unknown } } | null)?.metadataEditor;
	const ctor = editor?.constructor;
	return typeof ctor === "function" ? (ctor as MetadataEditorCtor) : null;
}

/**
 * Find the MetadataEditor class. Prefer a markdown view that's already open; otherwise
 * construct a throwaway MarkdownView (its constructor registers no global events in 1.14.4)
 * just to read the class, then discard it.
 */
function getMetadataEditorCtor(app: App, probeLeaf: WorkspaceLeaf): MetadataEditorCtor | null {
	if (cachedCtor !== undefined) return cachedCtor;
	cachedCtor = null;
	try {
		for (const leaf of app.workspace.getLeavesOfType("markdown")) {
			const ctor = ctorFromView(leaf.view);
			if (ctor) return (cachedCtor = ctor);
		}
		cachedCtor = ctorFromView(new MarkdownView(probeLeaf));
	} catch (err) {
		console.warn("[smart-folders] Native properties editor unavailable", err);
	}
	return cachedCtor;
}

function looksLikeEditor(e: unknown): e is NativePropertiesEditor {
	const x = e as Partial<NativePropertiesEditor> | null;
	return x?.containerEl instanceof HTMLElement && typeof x.synchronize === "function" && typeof x.load === "function";
}

export interface NativeEditorOptions {
	app: App;
	/** Any leaf; only used if a throwaway MarkdownView is needed to find the class. */
	probeLeaf: WorkspaceLeaf;
	hoverSource: string;
	save: (data: FolderFrontmatter) => Promise<void>;
}

/** A native properties editor wired to `save`, or null if this Obsidian build doesn't allow it. */
export function createNativePropertiesEditor(opts: NativeEditorOptions): NativePropertiesEditor | null {
	const Ctor = getMetadataEditorCtor(opts.app, opts.probeLeaf);
	if (!Ctor) return null;

	let editor: NativePropertiesEditor | null = null;
	const owner: MetadataEditorOwner = {
		getFile: () => null,
		getHoverSource: () => opts.hoverSource,
		saveFrontmatter: (data) => {
			// Mirror the note flow: write, then re-sync the editor from what was saved
			// (in notes this happens via the metadata cache "changed" event).
			opts.save(data).then(
				() => editor?.synchronize(data),
				(err) => console.error("[smart-folders] Failed to save folder properties", err),
			);
		},
		focusAfterMetadata: () => {},
		focusBeforeMetadata: () => {},
		onMarkdownFold: () => {},
	};

	try {
		const instance: unknown = new Ctor(opts.app, owner);
		if (!looksLikeEditor(instance)) return null;
		editor = instance;
		return editor;
	} catch (err) {
		console.warn("[smart-folders] Failed to construct native properties editor", err);
		return null;
	}
}

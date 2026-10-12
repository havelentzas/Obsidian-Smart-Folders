/**
 * Update [[Folder]] links when a folder is renamed or moved.
 *
 * Obsidian only rewrites links to FILES on rename, so folder links would silently break.
 * Mirrors Obsidian's own rename flow: if the vault option "Automatically update internal
 * links" (`alwaysUpdateLinks`, private config) is on, update and show a notice; otherwise ask
 * with Always update / Just once / Don't update ("Always update" turns that option on, as in
 * Obsidian's own dialog).
 *
 * Pure logic (which links change, to what, and text edits) lives in core/folder-links.ts.
 */

import { App, Modal, Notice, TFile, TFolder, parseLinktext, type Reference } from "obsidian";
import {
	FolderIndex,
	applyTextEdits,
	foldersBeforeRename,
	replaceLinkpath,
	rewriteFolderLinkpath,
	type TextEdit,
} from "../core/folder-links";

export interface FolderRenameHost {
	app: App;
	isEnabled(): boolean;
	/** Current (post-rename) folder paths, excluding root. */
	currentFolderPaths(): string[];
	registerEvent: (ref: ReturnType<App["vault"]["on"]>) => void;
}

interface Rename {
	oldPath: string;
	newPath: string;
}

interface FrontmatterEdit {
	key: string;
	original: string;
	replacement: string;
}

interface FilePlan {
	file: TFile;
	body: TextEdit[];
	frontmatter: FrontmatterEdit[];
}

interface InternalVaultConfig {
	getConfig?(key: string): unknown;
	setConfig?(key: string, value: unknown): void;
}

export class FolderRenameLinkUpdater {
	private queue: Rename[] = [];
	private flushTimer: number | null = null;

	constructor(private readonly host: FolderRenameHost) {}

	install(): void {
		this.host.registerEvent(
			this.host.app.vault.on("rename", (file, oldPath) => {
				if (!(file instanceof TFolder) || !this.host.isEnabled()) return;
				this.queue.push({ oldPath, newPath: file.path });
				// Obsidian also fires rename for every descendant; batch them and keep the top-most.
				if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
				this.flushTimer = window.setTimeout(() => void this.flush(), 100);
			}),
		);
	}

	private async flush(): Promise<void> {
		this.flushTimer = null;
		const renames = this.queue;
		this.queue = [];
		const topLevel = renames.filter(
			(r) => !renames.some((o) => o !== r && r.oldPath.startsWith(`${o.oldPath}/`)),
		);
		for (const rename of topLevel) await this.handle(rename);
	}

	private async handle(rename: Rename): Promise<void> {
		const plans = this.plan(rename);
		const linkCount = plans.reduce((n, p) => n + p.body.length + p.frontmatter.length, 0);
		if (linkCount === 0) return;

		const vault = this.host.app.vault as unknown as InternalVaultConfig;
		const always = vault.getConfig?.("alwaysUpdateLinks") === true;
		const choice = always ? "once" : await new ConfirmFolderLinkUpdate(this.host.app, rename, linkCount, plans.length).ask();
		if (choice === "skip") return;
		if (choice === "always") vault.setConfig?.("alwaysUpdateLinks", true);

		let applied = 0;
		for (const plan of plans) applied += await this.apply(plan);
		new Notice(`Updated ${applied} folder link${applied === 1 ? "" : "s"} in ${plans.length} file${plans.length === 1 ? "" : "s"}.`);
	}

	/** Every note link that pointed at the renamed folder (or a folder inside it) and needs new text. */
	private plan(rename: Rename): FilePlan[] {
		const { metadataCache, vault } = this.host.app;
		const current = this.host.currentFolderPaths();
		const ctxBase = {
			before: new FolderIndex(foldersBeforeRename(current, rename.oldPath, rename.newPath)),
			after: new FolderIndex(current),
			oldPath: rename.oldPath,
			newPath: rename.newPath,
		};

		const plans: FilePlan[] = [];
		for (const file of vault.getMarkdownFiles()) {
			const cache = metadataCache.getFileCache(file);
			if (!cache) continue;
			const ctx = { ...ctxBase, noteResolves: (t: string) => metadataCache.getFirstLinkpathDest(t, file.path) !== null };
			const rewrite = (ref: Reference): { original: string; replacement: string } | null => {
				const { path } = parseLinktext(ref.link);
				if (metadataCache.getFirstLinkpathDest(path, file.path)) return null; // a note owns this link
				const next = rewriteFolderLinkpath(path, ctx);
				const replacement = next === null ? null : replaceLinkpath(ref.original, path, next);
				return replacement === null ? null : { original: ref.original, replacement };
			};

			const body: TextEdit[] = [];
			for (const ref of [...(cache.links ?? []), ...(cache.embeds ?? [])]) {
				const r = rewrite(ref);
				if (r) body.push({ start: ref.position.start.offset, end: ref.position.end.offset, ...r });
			}
			const frontmatter: FrontmatterEdit[] = [];
			for (const ref of cache.frontmatterLinks ?? []) {
				const r = rewrite(ref);
				if (r) frontmatter.push({ key: ref.key, ...r });
			}
			if (body.length > 0 || frontmatter.length > 0) plans.push({ file, body, frontmatter });
		}
		return plans;
	}

	private async apply(plan: FilePlan): Promise<number> {
		let applied = 0;
		if (plan.body.length > 0) {
			await this.host.app.vault.process(plan.file, (data) => {
				const result = applyTextEdits(data, plan.body);
				applied += result.applied;
				return result.text;
			});
		}
		if (plan.frontmatter.length > 0) {
			await this.host.app.fileManager.processFrontMatter(plan.file, (fm: Record<string, unknown>) => {
				for (const edit of plan.frontmatter) if (replaceFrontmatterValue(fm, edit)) applied++;
			});
		}
		return applied;
	}
}

/**
 * Frontmatter link keys are "prop" for a single value or "prop.N" for list items.
 * Replaces the value only if it still equals the link's original text.
 */
function replaceFrontmatterValue(fm: Record<string, unknown>, edit: FrontmatterEdit): boolean {
	const match = edit.key.match(/^(.*)\.(\d+)$/);
	if (match && Array.isArray(fm[match[1] ?? ""])) {
		const list = fm[match[1] ?? ""] as unknown[];
		const i = Number(match[2]);
		if (list[i] !== edit.original) return false;
		list[i] = edit.replacement;
		return true;
	}
	if (fm[edit.key] !== edit.original) return false;
	fm[edit.key] = edit.replacement;
	return true;
}

type Choice = "always" | "once" | "skip";

/** Same wording and buttons as Obsidian's own "Update links" dialog. */
class ConfirmFolderLinkUpdate extends Modal {
	private resolve: (choice: Choice) => void = () => {};
	private chosen: Choice = "skip";

	constructor(
		app: App,
		private readonly rename: Rename,
		private readonly links: number,
		private readonly files: number,
	) {
		super(app);
	}

	ask(): Promise<Choice> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.titleEl.setText("Update links");
		this.contentEl.createEl("p", {
			text: `Do you want to update links to the folder "${this.rename.oldPath}" (now "${this.rename.newPath}")?`,
		});
		this.contentEl.createEl("p", {
			text: `${this.links} link${this.links === 1 ? "" : "s"} in ${this.files} file${this.files === 1 ? "" : "s"} will be updated.`,
		});
		const buttons = this.modalEl.createDiv({ cls: "modal-button-container" });
		const add = (text: string, choice: Choice, cls?: string) => {
			const btn = buttons.createEl("button", { text, cls });
			btn.addEventListener("click", () => {
				this.chosen = choice;
				this.close();
			});
		};
		add("Always update", "always", "mod-cta");
		add("Just once", "once");
		add("Don't update", "skip");
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(this.chosen);
	}
}

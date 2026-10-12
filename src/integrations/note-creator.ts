/**
 * Creates a new note in a folder from a folder template, then opens it.
 *
 * - Templater enabled → Templater parses the template (`<% tp.* %>` syntax).
 * - Otherwise → core-Templates-style vars ({{title}}, {{date}}, {{time}}) via core/template-vars.
 *
 * Both paths name the note "Untitled" (next free number) and open it with the title
 * selected for renaming, matching Obsidian's "New note" behaviour.
 */

import { App, Notice, TFile, TFolder, moment } from "obsidian";
import { availableNotePath, basename, normalizeFolderPath } from "../core/paths";
import { applyTemplateVars } from "../core/template-vars";
import type { FolderTemplate } from "../core/types";
import type { OsfStore } from "../services/osf-store";
import { getTemplater } from "./templater";

const NEW_NOTE_NAME = "Untitled";

export class NoteCreator {
	constructor(
		private readonly app: App,
		private readonly store: OsfStore,
	) {}

	async createFromTemplate(template: FolderTemplate, folderPath: string): Promise<TFile | null> {
		const folder = this.getFolder(folderPath);
		if (!folder) {
			new Notice(`Folder not found: ${folderPath || "/"}`);
			return null;
		}
		const content = await this.store.readTemplate(template);

		const templater = getTemplater(this.app);
		if (templater) {
			return (await templater.create_new_note_from_template(content, folder, NEW_NOTE_NAME, true)) ?? null;
		}

		const vault = this.app.vault;
		const path = availableNotePath(normalizeFolderPath(folder.path), NEW_NOTE_NAME, (p) =>
			Boolean(vault.getAbstractFileByPath(p)),
		);
		const body = applyTemplateVars(content, {
			title: basename(path).replace(/\.md$/, ""),
			now: new Date(),
			formatDate: (date, format) => moment(date).format(format),
		});
		const file = await vault.create(path, body);
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { state: { mode: "source" } });
		leaf.setEphemeralState({ rename: "all" });
		return file;
	}

	private getFolder(folderPath: string): TFolder | null {
		const p = normalizeFolderPath(folderPath);
		if (p === "") return this.app.vault.getRoot();
		const f = this.app.vault.getAbstractFileByPath(p);
		return f instanceof TFolder ? f : null;
	}
}

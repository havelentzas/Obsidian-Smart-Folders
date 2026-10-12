/**
 * Confirmation for "Remove all Smart Folders data": lists the folders whose .osf/ will be
 * moved to the trash. Resolves true only if the user clicks the remove button.
 */

import { App, Modal } from "obsidian";

const MAX_LISTED = 12;

export class ConfirmRemoveDataModal extends Modal {
	private resolve: (confirmed: boolean) => void = () => {};
	private confirmed = false;

	constructor(
		app: App,
		private readonly folders: string[],
	) {
		super(app);
	}

	ask(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const n = this.folders.length;
		this.titleEl.setText("Remove all Smart Folders data?");
		this.contentEl.createEl("p", {
			text:
				`This moves the hidden .osf folder of ${n} folder${n === 1 ? "" : "s"} to the trash: ` +
				"their properties and folder templates. Your notes and folders are not touched.",
		});
		const list = this.contentEl.createEl("ul", { cls: "smart-folders-remove-list" });
		for (const folder of this.folders.slice(0, MAX_LISTED)) list.createEl("li", { text: folder || "/ (vault root)" });
		if (n > MAX_LISTED) list.createEl("li", { cls: "smart-folders-hover-muted", text: `…and ${n - MAX_LISTED} more` });
		this.contentEl.createEl("p", {
			cls: "smart-folders-hover-muted",
			text: "[[Folder]] links in your notes are left as they are. You can restore the data from the trash.",
		});

		const buttons = this.modalEl.createDiv({ cls: "modal-button-container" });
		buttons.createEl("button", { text: "Move to trash", cls: "mod-warning" }).addEventListener("click", () => {
			this.confirmed = true;
			this.close();
		});
		buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(this.confirmed);
	}
}

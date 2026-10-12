/**
 * Command-palette prompt: fuzzy-pick one of a folder's templates (own + inherited)
 * and create a note from it in that folder.
 */

import { App, FuzzyMatch, FuzzySuggestModal } from "obsidian";
import { basename } from "../core/paths";
import type { FolderTemplate, TemplateGroup } from "../core/types";

interface TemplateChoice {
	template: FolderTemplate;
	/** Folder the template comes from. */
	sourcePath: string;
	inherited: boolean;
}

export class TemplatePickerModal extends FuzzySuggestModal<TemplateChoice> {
	private readonly choices: TemplateChoice[];

	constructor(
		app: App,
		folderPath: string,
		groups: TemplateGroup[],
		private readonly onChoose: (template: FolderTemplate) => void,
	) {
		super(app);
		this.choices = groups.flatMap((g) =>
			g.templates.map((template) => ({
				template,
				sourcePath: g.folderPath,
				inherited: g.folderPath !== folderPath,
			})),
		);
		this.setPlaceholder(`New note in ${basename(folderPath) || app.vault.getName()} from template…`);
	}

	getItems(): TemplateChoice[] {
		return this.choices;
	}

	getItemText(choice: TemplateChoice): string {
		return choice.template.name;
	}

	renderSuggestion(match: FuzzyMatch<TemplateChoice>, el: HTMLElement): void {
		super.renderSuggestion(match, el);
		if (match.item.inherited) {
			el.createDiv({
				cls: "smart-folders-suggestion-source",
				text: `from ${basename(match.item.sourcePath) || this.app.vault.getName()}`,
			});
		}
	}

	onChooseItem(choice: TemplateChoice): void {
		this.onChoose(choice.template);
	}
}

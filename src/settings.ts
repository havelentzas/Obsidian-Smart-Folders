import { App, PluginSettingTab, Setting } from "obsidian";
import type SmartFoldersPlugin from "./main";

export interface SmartFoldersSettings {
	/** Open the folder page when a folder is clicked in the file explorer. */
	openOnFolderClick: boolean;
	/** Open the folder page in the right sidebar instead of the main (note) area. */
	openInRightSidebar: boolean;
	/** Edit folder properties as raw YAML instead of with Obsidian's native properties editor. */
	rawYamlProperties: boolean;
	/** [[Folder name]] links: autocomplete, normal link styling, click opens the folder page, graph nodes. */
	folderLinks: boolean;
	/** Graph view "Folders" filter toggle (global graph / local graph), like the native Tags toggle. */
	graphShowFolders: boolean;
	localGraphShowFolders: boolean;
}

export const DEFAULT_SETTINGS: SmartFoldersSettings = {
	openOnFolderClick: true,
	openInRightSidebar: false,
	rawYamlProperties: false,
	folderLinks: true,
	graphShowFolders: false,
	localGraphShowFolders: false,
};

export class SmartFoldersSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: SmartFoldersPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Open folder page on click")
			.setDesc("Clicking a folder in the file explorer opens its folder page (it still expands/collapses).")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openOnFolderClick).onChange(async (value) => {
					this.plugin.settings.openOnFolderClick = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Open folder page in right sidebar")
			.setDesc("Off: opens in the main area, replacing the current tab. On: opens in the right sidebar, reusing one sidebar tab.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openInRightSidebar).onChange(async (value) => {
					this.plugin.settings.openInRightSidebar = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Edit folder properties as raw YAML")
			.setDesc(
				"Off: the same properties editor as notes (property types, tag and value autofill). On: a plain YAML text box.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.rawYamlProperties).onChange(async (value) => {
					this.plugin.settings.rawYamlProperties = value;
					await this.plugin.saveSettings();
					this.plugin.refreshFolderPages();
				}),
			);

		new Setting(containerEl)
			.setName("Folder links")
			.setDesc(
				"Link to folders like notes: [[Folder name]], or [[Folder name/]] if a note has the same name. " +
					"Clicking opens the folder page. Adds a \"Folders\" toggle to the graph view's filters. " +
					"Reopen notes to update existing link styling.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.folderLinks).onChange(async (value) => {
					this.plugin.settings.folderLinks = value;
					await this.plugin.saveSettings();
					this.plugin.graphFolders.refresh();
				}),
			);

		new Setting(containerEl).setName("Remove data").setHeading();
		new Setting(containerEl)
			.setName("Remove all Smart Folders data")
			.setDesc(
				"Moves every folder's hidden .osf folder (properties and folder templates) to the trash, " +
					"e.g. before uninstalling or moving to another app. You'll see the list and confirm first.",
			)
			.addButton((button) =>
				button
					.setButtonText("Remove…")
					.setWarning()
					.onClick(() => void this.plugin.removeAllData()),
			);
	}
}

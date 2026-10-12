/**
 * Templater integration via its (unofficial) plugin instance.
 *
 * We pass the template's TEXT, not a TFile: .osf/ templates are invisible to the
 * Vault API, so there is no TFile. Templater 2.x supports this — when given a string,
 * `create_new_note_from_template` parses it as template content, creates the note in
 * `folder`, opens it, and starts a rename. Verified against Templater 2.20.6.
 *
 * Uses private Obsidian API (`app.plugins`) — everything is feature-checked so a
 * Templater update degrades to "not available" instead of crashing.
 */

import type { App, TFile, TFolder } from "obsidian";

export const TEMPLATER_ID = "templater-obsidian";

interface TemplaterCore {
	create_new_note_from_template(
		template: TFile | string,
		folder?: TFolder | string,
		filename?: string,
		openNewNote?: boolean,
	): Promise<TFile | undefined>;
}

interface PluginRegistry {
	enabledPlugins?: Set<string>;
	plugins?: Record<string, { templater?: Partial<TemplaterCore> } | undefined>;
}

/** Templater's core if it is installed, enabled, and exposes the API we need; otherwise null. */
export function getTemplater(app: App): TemplaterCore | null {
	const registry = (app as unknown as { plugins?: PluginRegistry }).plugins;
	if (!registry?.enabledPlugins?.has(TEMPLATER_ID)) return null;
	const core = registry.plugins?.[TEMPLATER_ID]?.templater;
	if (typeof core?.create_new_note_from_template !== "function") return null;
	return core as TemplaterCore;
}

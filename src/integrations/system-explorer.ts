/**
 * Open a vault folder in the OS file manager (Finder / Explorer).
 *
 * Needed because .osf/ is a dot-folder that Obsidian's own File Explorer never shows.
 * Desktop only: uses FileSystemAdapter + Electron's `shell`, both feature-checked.
 */

import { App, FileSystemAdapter } from "obsidian";

interface ElectronShell {
	openPath(path: string): Promise<string>;
}

function getElectronShell(): ElectronShell | null {
	const req = (window as unknown as { require?: (id: string) => unknown }).require;
	if (typeof req !== "function") return null;
	try {
		const shell = (req("electron") as { shell?: Partial<ElectronShell> } | undefined)?.shell;
		return typeof shell?.openPath === "function" ? (shell as ElectronShell) : null;
	} catch {
		return null;
	}
}

/** Returns false if this platform can't open folders (e.g. mobile). */
export async function openInSystemExplorer(app: App, vaultPath: string): Promise<boolean> {
	const adapter = app.vault.adapter;
	const shell = getElectronShell();
	if (!(adapter instanceof FileSystemAdapter) || !shell) return false;
	const error = await shell.openPath(adapter.getFullPath(vaultPath));
	return error === "";
}

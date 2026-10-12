/**
 * OsfFileSystem backed by Obsidian's DataAdapter (`app.vault.adapter`), the only API that can
 * see dot-folders. Trash goes to the OS trash, falling back to the vault's `.trash/` folder
 * (the pattern Obsidian's own docs give) — never a hard delete.
 */

import type { DataAdapter } from "obsidian";
import type { OsfFileSystem } from "../core/types";

export function vaultFs(adapter: DataAdapter): OsfFileSystem {
	return {
		exists: (path) => adapter.exists(path),
		read: (path) => adapter.read(path),
		write: (path, data) => adapter.write(path, data),
		mkdir: (path) => adapter.mkdir(path),
		list: (path) => adapter.list(path),
		trash: async (path) => {
			if (!(await adapter.trashSystem(path))) await adapter.trashLocal(path);
		},
	};
}

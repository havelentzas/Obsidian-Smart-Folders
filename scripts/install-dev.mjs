// Copies the built plugin into a test vault so it can be loaded in Obsidian.
// Usage: OBSIDIAN_VAULT=/path/to/TestVault npm run install:vault
// Use a throwaway test vault, never a real one.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const vault = process.env.OBSIDIAN_VAULT;
if (!vault) {
	console.error("Set OBSIDIAN_VAULT to the path of a TEST vault.");
	process.exit(1);
}
if (!existsSync(join(vault, ".obsidian"))) {
	console.error(`${vault} does not look like a vault (no .obsidian/ folder).`);
	process.exit(1);
}
if (!existsSync("main.js")) {
	console.error("main.js not found — run `npm run build` first.");
	process.exit(1);
}

const { id } = JSON.parse(readFileSync("manifest.json", "utf8"));
const dest = join(vault, ".obsidian", "plugins", id);
mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(f, join(dest, f));
console.log(`Installed ${id} to ${dest}. Reload Obsidian (or toggle the plugin) to pick it up.`);

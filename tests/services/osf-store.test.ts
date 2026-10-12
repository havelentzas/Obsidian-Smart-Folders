import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { FrontmatterParseError } from "../../src/core/frontmatter";
import { OsfStore } from "../../src/services/osf-store";
import { MemoryFs } from "../fakes/memory-fs";

const codec = { parse, stringify };

describe("OsfStore", () => {
	it("returns {} for a folder without .osf", async () => {
		const store = new OsfStore(new MemoryFs(), codec);
		expect(await store.hasOsf("Projects")).toBe(false);
		expect(await store.readFrontmatter("Projects")).toEqual({});
	});

	it("creates .osf lazily on write", async () => {
		const fs = new MemoryFs();
		const store = new OsfStore(fs, codec);
		await store.writeFrontmatter("Projects", { status: "active" });
		expect(fs.folders.has("Projects/.osf")).toBe(true);
		expect(await store.readFrontmatter("Projects")).toEqual({ status: "active" });
	});

	it("does not write invalid YAML text", async () => {
		const fs = new MemoryFs({ "P/.osf/frontmatter.yaml": "a: 1\n" });
		const store = new OsfStore(fs, codec);
		await expect(store.writeFrontmatterText("P", "- not a mapping")).rejects.toThrow(FrontmatterParseError);
		expect(fs.files.get("P/.osf/frontmatter.yaml")).toBe("a: 1\n");
	});

	it("lists only .md templates, sorted", async () => {
		const store = new OsfStore(
			new MemoryFs({
				"P/.osf/templates/Zeta.md": "",
				"P/.osf/templates/alpha.md": "",
				"P/.osf/templates/notes.txt": "",
			}),
			codec,
		);
		expect(await store.listTemplates("P")).toEqual([
			{ name: "alpha", path: "P/.osf/templates/alpha.md" },
			{ name: "Zeta", path: "P/.osf/templates/Zeta.md" },
		]);
	});

	it("works at the vault root", async () => {
		const fs = new MemoryFs();
		const store = new OsfStore(fs, codec);
		await store.writeFrontmatter("/", { kind: "vault" });
		expect(fs.files.has(".osf/frontmatter.yaml")).toBe(true);
	});

	describe("inherited templates", () => {
		const fs = () =>
			new MemoryFs({
				".osf/templates/Root.md": "root",
				"A/.osf/templates/FromA.md": "a",
				"A/B/.osf/templates/Own.md": "own",
				"A/B/C/.keep": "",
			});

		it("groups templates by ancestor, nearest first, skipping ancestors without templates", async () => {
			const store = new OsfStore(fs(), codec);
			expect(await store.listInheritedTemplates("A/B/C")).toEqual([
				{ folderPath: "A/B", templates: [{ name: "Own", path: "A/B/.osf/templates/Own.md" }] },
				{ folderPath: "A", templates: [{ name: "FromA", path: "A/.osf/templates/FromA.md" }] },
				{ folderPath: "", templates: [{ name: "Root", path: ".osf/templates/Root.md" }] },
			]);
		});

		it("does not include the folder's own templates in the inherited list", async () => {
			const store = new OsfStore(fs(), codec);
			const groups = await store.listInheritedTemplates("A/B");
			expect(groups.map((g) => g.folderPath)).toEqual(["A", ""]);
		});

		it("listAllTemplateGroups puts own templates first", async () => {
			const store = new OsfStore(fs(), codec);
			const groups = await store.listAllTemplateGroups("A/B");
			expect(groups.map((g) => g.folderPath)).toEqual(["A/B", "A", ""]);
		});

		it("reads template content", async () => {
			const store = new OsfStore(fs(), codec);
			expect(await store.readTemplate({ name: "FromA", path: "A/.osf/templates/FromA.md" })).toBe("a");
		});
	});

	it("ensureTemplatesDir creates .osf/templates idempotently and returns its path", async () => {
		const fs = new MemoryFs();
		const store = new OsfStore(fs, codec);
		expect(await store.ensureTemplatesDir("P")).toBe("P/.osf/templates");
		expect(fs.folders.has("P/.osf/templates")).toBe(true);
		expect(await store.ensureTemplatesDir("P")).toBe("P/.osf/templates");
		expect(await store.listTemplates("P")).toEqual([]);
	});

	it("hides inherited templates shadowed by a nearer same-named template", async () => {
		const store = new OsfStore(
			new MemoryFs({
				".osf/templates/Meeting.md": "root",
				"A/.osf/templates/Meeting.md": "a",
				"A/.osf/templates/Log.md": "",
				"A/B/.osf/templates/meeting.md": "own",
			}),
			codec,
		);
		expect(await store.listInheritedTemplates("A/B")).toEqual([
			{ folderPath: "A", templates: [{ name: "Log", path: "A/.osf/templates/Log.md" }] },
		]);
		const all = await store.listAllTemplateGroups("A/B/C");
		expect(all.map((g) => [g.folderPath, g.templates.map((t) => t.name)])).toEqual([
			["A/B", ["meeting"]],
			["A", ["Log"]],
		]);
	});

	describe("removing all data", () => {
		const seeded = () =>
			new MemoryFs({
				".osf/frontmatter.yaml": "",
				"A/.osf/templates/T.md": "x",
				"A/B/.osf/frontmatter.yaml": "a: 1\n",
				"A/note.md": "keep me",
			});

		it("finds folders with .osf, including root, ignoring duplicates and bare folders", async () => {
			const store = new OsfStore(seeded(), codec);
			expect(await store.findOsfFolders(["/", "A", "A/B", "A/", "C"])).toEqual(["", "A", "A/B"]);
		});

		it("trashes only .osf directories and leaves notes alone", async () => {
			const fs = seeded();
			const store = new OsfStore(fs, codec);
			const result = await store.removeOsf(["", "A", "A/B"]);
			expect(result).toEqual({ removed: ["", "A", "A/B"], failed: [] });
			expect(fs.trashed).toEqual([".osf", "A/.osf", "A/B/.osf"]);
			expect([...fs.files.keys()]).toEqual(["A/note.md"]);
		});

		it("keeps going past a failure and reports it", async () => {
			const fs = seeded();
			fs.failTrash.add("A/.osf");
			const result = await new OsfStore(fs, codec).removeOsf(["", "A", "A/B"]);
			expect(result).toEqual({ removed: ["", "A/B"], failed: ["A"] });
			expect(fs.files.has("A/.osf/templates/T.md")).toBe(true);
		});
	});
});

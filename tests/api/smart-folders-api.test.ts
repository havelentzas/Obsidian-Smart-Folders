import { describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";

// The `obsidian` package is types-only; the API module only needs TFolder at runtime.
vi.mock("obsidian", () => ({ TFolder: class TFolder {} }));

const { TFolder } = await import("obsidian");
const { createSmartFoldersApi } = await import("../../src/api/smart-folders-api");
const { SMART_FOLDERS_API_VERSION } = await import("../../src/api/types");
const { OsfStore } = await import("../../src/services/osf-store");
const { FolderPropertiesIndex } = await import("../../src/services/folder-properties-index");
const { MemoryFs } = await import("../fakes/memory-fs");

const FOLDERS = ["A", "A/B", "Empty"];

async function setup() {
	const fs = new MemoryFs({
		"A/.osf/frontmatter.yaml": "status: active\ntags: [x]\n",
		"A/.osf/templates/Meeting.md": "m",
		"A/B/.osf/templates/Task.md": "t",
	});
	const store = new OsfStore(fs, { parse, stringify });
	const index = new FolderPropertiesIndex(store);
	const createNote = vi.fn(async () => null);
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (FOLDERS.includes(p) ? Object.assign(new TFolder(), { path: p }) : null),
		},
	};
	const api = createSmartFoldersApi({
		app: app as never,
		pluginVersion: "9.9.9",
		store,
		index,
		createNote,
		resolveFolderLink: (t) => (t === "A" ? "A" : null),
		openFolderPage: async () => {},
	});
	await index.rebuild(["", ...FOLDERS]);
	return { api, fs, index, createNote };
}

describe("SmartFoldersApi", () => {
	it("reports versions and readiness", async () => {
		const { api } = await setup();
		expect(api.apiVersion).toBe(SMART_FOLDERS_API_VERSION);
		expect(api.pluginVersion).toBe("9.9.9");
		expect(api.isReady()).toBe(true);
		await expect(api.whenReady()).resolves.toBeUndefined();
		expect(Object.isFrozen(api)).toBe(true);
	});

	it("returns copies of properties: {} when none, null when the folder doesn't exist", async () => {
		const { api } = await setup();
		const props = api.getFolderProperties("A/")!;
		expect(props).toEqual({ status: "active", tags: ["x"] });
		(props.tags as string[]).push("mutated");
		expect(api.getFolderProperties("A")).toEqual({ status: "active", tags: ["x"] });
		expect(api.getFolderProperties("Empty")).toEqual({});
		expect(api.getFolderProperties("Nope")).toBeNull();
		expect(api.getFolderProperties("/")).toEqual({});
		expect(api.getFoldersWithProperties()).toEqual(["A"]);
	});

	it("writes properties, fires change events, and validates input", async () => {
		const { api, fs, index } = await setup();
		const events: unknown[] = [];
		index.onChange((p, fm) => events.push([p, fm]));
		await api.setFolderProperties("Empty", { owner: "Ana" });
		expect(fs.files.get("Empty/.osf/frontmatter.yaml")).toContain("owner: Ana");
		expect(api.getFolderProperties("Empty")).toEqual({ owner: "Ana" });
		await api.updateFolderProperties("A", (p) => ({ ...p, status: "done" }));
		expect(api.getFolderProperties("A")).toEqual({ status: "done", tags: ["x"] });
		expect(events).toEqual([
			["Empty", { owner: "Ana" }],
			["A", { status: "done", tags: ["x"] }],
		]);
		await expect(api.setFolderProperties("Nope", {})).rejects.toThrow(/no folder/);
		await expect(api.setFolderProperties("A", ["x"] as never)).rejects.toThrow(/plain object/);
		await expect(api.setFolderProperties("A", new Date() as never)).rejects.toThrow(/plain object/);
	});

	it("lists own and inherited templates and only creates notes from .osf templates", async () => {
		const { api, createNote } = await setup();
		const groups = await api.getFolderTemplates("A/B");
		expect(groups).toEqual([
			{ folderPath: "A/B", inherited: false, templates: [{ name: "Task", path: "A/B/.osf/templates/Task.md" }] },
			{ folderPath: "A", inherited: true, templates: [{ name: "Meeting", path: "A/.osf/templates/Meeting.md" }] },
		]);
		await api.createNoteFromTemplate(groups[1]!.templates[0]!, "A/B");
		expect(createNote).toHaveBeenCalledWith({ name: "Meeting", path: "A/.osf/templates/Meeting.md" }, "A/B");
		await expect(api.createNoteFromTemplate({ name: "x", path: "Notes/x.md" }, "A")).rejects.toThrow(/getFolderTemplates/);
	});

	it("resolves links and exposes data paths", async () => {
		const { api } = await setup();
		expect(api.resolveFolderLink("A", "")).toBe("A");
		expect(api.resolveFolderLink("Z", "")).toBeNull();
		expect(api.getFolderDataPaths("A/B")).toEqual({
			osfDir: "A/B/.osf",
			propertiesFile: "A/B/.osf/frontmatter.yaml",
			templatesDir: "A/B/.osf/templates",
		});
		expect(api.getFolderDataPaths("/").osfDir).toBe(".osf");
	});
});

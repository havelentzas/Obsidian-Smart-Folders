import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { FolderPropertiesIndex } from "../../src/services/folder-properties-index";
import { OsfStore } from "../../src/services/osf-store";
import { MemoryFs } from "../fakes/memory-fs";

const codec = { parse, stringify };

function setup() {
	const fs = new MemoryFs({
		".osf/frontmatter.yaml": "scope: vault\n",
		"A/.osf/frontmatter.yaml": "tags: [project]\nclient: Acme\n",
		"A/B/.osf/frontmatter.yaml": "tags: [project/sub]\n",
		"Bad/.osf/frontmatter.yaml": "- not a mapping\n",
		"Empty/.osf/frontmatter.yaml": "",
	});
	const store = new OsfStore(fs, codec);
	const index = new FolderPropertiesIndex(store);
	return { fs, store, index };
}

const ALL = ["/", "A", "A/B", "Bad", "Empty", "C"];

describe("FolderPropertiesIndex", () => {
	it("rebuilds from disk, skipping invalid and empty frontmatter", async () => {
		const { index } = setup();
		await index.rebuild(ALL);
		expect(index.get("")).toEqual({ scope: "vault" });
		expect(index.get("A")).toEqual({ tags: ["project"], client: "Acme" });
		expect(index.get("Bad")).toBeNull();
		expect(index.get("Empty")).toBeNull();
		expect(index.tagCounts()).toEqual({ "#project": 2, "#project/sub": 1 });
		expect(index.valuesForKey("client")).toEqual(["Acme"]);
		expect(Object.keys(index.propertyInfos()).sort()).toEqual(["client", "scope", "tags"]);
	});

	it("follows the store's own writes and .osf removal", async () => {
		const { store, index } = setup();
		await index.rebuild(ALL);
		await store.writeFrontmatter("C", { client: "Globex" });
		expect(index.valuesForKey("client").sort()).toEqual(["Acme", "Globex"]);
		await store.writeFrontmatterText("A", "client: Initech\n");
		expect(index.get("A")).toEqual({ client: "Initech" });
		expect(index.tagCounts()).toEqual({ "#project/sub": 1, "#project": 1 });
		await store.removeOsf(["A"]);
		expect(index.get("A")).toBeNull();
		expect(index.get("A/B")).not.toBeNull(); // only A's own .osf went
	});

	it("re-keys on folder rename and drops a deleted subtree", async () => {
		const { index } = setup();
		await index.rebuild(ALL);
		index.rename("A", "Z");
		expect(index.get("A")).toBeNull();
		expect(index.get("Z/B")).toEqual({ tags: ["project/sub"] });
		index.delete("Z");
		expect(index.get("Z")).toBeNull();
		expect(index.get("Z/B")).toBeNull();
		expect(index.get("")).toEqual({ scope: "vault" });
	});
});

describe("FolderPropertiesIndex change events", () => {
	function record(index: FolderPropertiesIndex) {
		const events: [string, unknown][] = [];
		index.onChange((path, fm) => events.push([path, fm]));
		return events;
	}

	it("is ready after the first rebuild, which reports no changes", async () => {
		const { index } = setup();
		const events = record(index);
		expect(index.isReady()).toBe(false);
		await index.rebuild(ALL);
		await index.whenReady();
		expect(index.isReady()).toBe(true);
		expect(events).toEqual([]);
	});

	it("reports only folders that changed on a later rebuild", async () => {
		const { fs, index } = setup();
		await index.rebuild(ALL);
		const events = record(index);
		fs.files.set("A/.osf/frontmatter.yaml", "client: Changed\n");
		fs.files.set("A/B/.osf/frontmatter.yaml", "");
		await index.rebuild(ALL);
		expect(events).toEqual([
			["A", { client: "Changed" }],
			["A/B", null],
		]);
	});

	it("reports saves (but not no-op saves), renames and deletes", async () => {
		const { store, index } = setup();
		await index.rebuild(ALL);
		const events = record(index);
		await store.writeFrontmatter("A", { tags: ["project"], client: "Acme" }); // unchanged
		await store.writeFrontmatter("C", { x: 1 });
		index.rename("A", "Z");
		index.delete("Z");
		expect(events).toEqual([
			["C", { x: 1 }],
			["A", null],
			["Z", { tags: ["project"], client: "Acme" }],
			["A/B", null],
			["Z/B", { tags: ["project/sub"] }],
			["Z", null],
			["Z/B", null],
		]);
	});

	it("keeps notifying other listeners when one throws, and can unsubscribe", async () => {
		const { store, index } = setup();
		await index.rebuild(ALL);
		index.onChange(() => {
			throw new Error("boom");
		});
		const events = record(index);
		const off = index.onChange(() => events.push(["second", null]));
		const spy = console.error;
		console.error = () => {};
		await store.writeFrontmatter("C", { x: 1 });
		off();
		await store.writeFrontmatter("C", { x: 2 });
		console.error = spy;
		expect(events).toEqual([
			["C", { x: 1 }],
			["second", null],
			["C", { x: 2 }],
		]);
	});
});

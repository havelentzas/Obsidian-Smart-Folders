import { describe, expect, it } from "vitest";
import {
	collectPropertyInfos,
	collectValuesForKey,
	countTags,
	frontmatterTags,
	inferWidget,
	mergeMissing,
	mergeTagCounts,
	mergeValues,
} from "../../src/core/folder-properties";

describe("inferWidget", () => {
	it("matches Obsidian's inference", () => {
		expect(inferWidget("hello")).toBe("text");
		expect(inferWidget("2026-10-12")).toBe("date");
		expect(inferWidget("2026-10-12T09:30")).toBe("datetime");
		expect(inferWidget(3)).toBe("number");
		expect(inferWidget(false)).toBe("checkbox");
		expect(inferWidget(["a", "b"])).toBe("multitext");
		expect(inferWidget(null)).toBe("text");
		expect(inferWidget({ a: 1 })).toBe("unknown");
	});
});

describe("collectPropertyInfos", () => {
	it("keys by lower-case name, keeps first spelling, types from first non-null value", () => {
		const infos = collectPropertyInfos([{ Status: null, due: "2026-01-01" }, { status: "active" }]);
		expect(infos).toEqual({
			status: { name: "Status", widget: "text" },
			due: { name: "due", widget: "date" },
		});
	});

	it("defaults to text when every value is empty", () => {
		expect(collectPropertyInfos([{ x: null }])).toEqual({ x: { name: "x", widget: "text" } });
	});
});

describe("collectValuesForKey", () => {
	it("collects strings and string list items for the exact key, deduplicated", () => {
		const fms = [{ client: "Acme", team: ["Ana", "Bo"] }, { client: "Acme", Client: "Other" }, { team: [1, "Ana"] }];
		expect(collectValuesForKey(fms, "client")).toEqual(["Acme"]);
		expect(collectValuesForKey(fms, "team")).toEqual(["Ana", "Bo"]);
		expect(collectValuesForKey(fms, "")).toEqual([]);
	});
});

describe("tags", () => {
	it("reads a tags list or string in any key case, normalising to #tag and dropping invalid ones", () => {
		expect(frontmatterTags({ Tags: ["project", "#area/work", "has space", ""] })).toEqual(["#project", "#area/work"]);
		expect(frontmatterTags({ tags: "solo" })).toEqual(["#solo"]);
		expect(frontmatterTags({ other: "x" })).toEqual([]);
	});

	it("counts nested tags toward their parents and skips number-only tags", () => {
		expect(countTags([{ tags: ["area/work", "project"] }, { tags: ["area", "2026"] }])).toEqual({
			"#area/work": 1,
			"#area": 2,
			"#project": 1,
		});
	});
});

describe("merging into Obsidian's data", () => {
	it("adds only missing properties, case-insensitively, and keeps base identity if nothing is added", () => {
		const base = { status: { name: "status", widget: "text" } };
		expect(mergeMissing(base, { Status: { name: "Status", widget: "number" } })).toBe(base);
		expect(mergeMissing(base, { client: { name: "client", widget: "text" } })).toEqual({
			status: { name: "status", widget: "text" },
			client: { name: "client", widget: "text" },
		});
	});

	it("sums tag counts and unions values in natural order", () => {
		expect(mergeTagCounts({ "#a": 2 }, { "#a": 1, "#b": 1 })).toEqual({ "#a": 3, "#b": 1 });
		expect(mergeValues(["item 10", "b"], ["item 2", "b"])).toEqual(["b", "item 2", "item 10"]);
	});
});

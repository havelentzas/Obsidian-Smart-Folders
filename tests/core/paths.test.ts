import { describe, expect, it } from "vitest";
import {
	ancestorsOf,
	availableNotePath,
	basename,
	frontmatterPathFor,
	isInsideOsf,
	normalizeFolderPath,
	osfDirFor,
	parentPath,
	templatesDirFor,
} from "../../src/core/paths";

describe("paths", () => {
	it("normalises root and slashes", () => {
		expect(normalizeFolderPath("/")).toBe("");
		expect(normalizeFolderPath("")).toBe("");
		expect(normalizeFolderPath("/Projects//Work/")).toBe("Projects/Work");
	});

	it("builds .osf paths for nested folders", () => {
		expect(osfDirFor("Projects/Work")).toBe("Projects/Work/.osf");
		expect(frontmatterPathFor("Projects/Work")).toBe("Projects/Work/.osf/frontmatter.yaml");
		expect(templatesDirFor("Projects/Work")).toBe("Projects/Work/.osf/templates");
	});

	it("builds .osf paths for the vault root", () => {
		expect(osfDirFor("/")).toBe(".osf");
		expect(frontmatterPathFor("")).toBe(".osf/frontmatter.yaml");
	});

	it("detects paths inside .osf", () => {
		expect(isInsideOsf("A/.osf/templates/x.md")).toBe(true);
		expect(isInsideOsf(".osf")).toBe(true);
		expect(isInsideOsf("A/.osfish/x.md")).toBe(false);
	});

	it("takes basenames", () => {
		expect(basename("A/B/c.md")).toBe("c.md");
		expect(basename("/")).toBe("");
	});
});

describe("ancestors and parents", () => {
	it("returns the parent path, root for top-level, null for root", () => {
		expect(parentPath("A/B/C")).toBe("A/B");
		expect(parentPath("A")).toBe("");
		expect(parentPath("/")).toBeNull();
	});

	it("lists ancestors nearest first, ending at root", () => {
		expect(ancestorsOf("A/B/C")).toEqual(["A/B", "A", ""]);
		expect(ancestorsOf("A")).toEqual([""]);
		expect(ancestorsOf("")).toEqual([]);
	});
});

describe("availableNotePath", () => {
	it("picks Untitled, then Untitled 1, 2...", () => {
		const taken = new Set(["F/Untitled.md", "F/Untitled 1.md"]);
		expect(availableNotePath("F", "Untitled", (p) => taken.has(p))).toBe("F/Untitled 2.md");
		expect(availableNotePath("", "Untitled", () => false)).toBe("Untitled.md");
	});
});

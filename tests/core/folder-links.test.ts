import { describe, expect, it } from "vitest";
import {
	FolderIndex,
	applyFolderNodes,
	applyTextEdits,
	folderLinktext,
	folderNodeId,
	foldersBeforeRename,
	renamedPath,
	replaceLinkpath,
	rewriteFolderLinkpath,
	type GraphData,
} from "../../src/core/folder-links";

const index = new FolderIndex(["Projects", "Projects/Work", "Archive/Work", "Archive", "Notes", "/"]);

describe("FolderIndex.resolve", () => {
	it("matches exact paths case-insensitively", () => {
		expect(index.resolve("projects/work")).toBe("Projects/Work");
	});

	it("treats a trailing slash as a folder signal", () => {
		expect(index.resolve("Projects/")).toBe("Projects");
	});

	it("matches by name, shallowest then alphabetical when ambiguous", () => {
		expect(index.resolve("Notes")).toBe("Notes");
		expect(index.resolve("work")).toBe("Archive/Work");
	});

	it("does not match partial paths or empty/root", () => {
		expect(index.resolve("Other/Work")).toBeNull();
		expect(index.resolve("")).toBeNull();
		expect(index.resolve("/")).toBeNull();
		expect(index.resolve("Missing")).toBeNull();
	});
});

describe("folderLinktext", () => {
	it("uses the name when unique, the path when ambiguous", () => {
		expect(folderLinktext("Notes", index, () => false)).toBe("Notes");
		expect(folderLinktext("Projects/Work", index, () => false)).toBe("Projects/Work");
	});

	it("adds a trailing slash when a note would win the link", () => {
		expect(folderLinktext("Notes", index, (t) => t === "Notes")).toBe("Notes/");
	});
});

describe("applyFolderNodes", () => {
	const color = { a: 1, rgb: 0xffcc00 };
	const make = (): GraphData => ({
		nodes: {
			"A.md": { type: "", links: { "Projects": true, "Ghost": true, "B.md": true } },
			"B.md": { type: "", links: {} },
			Projects: { type: "unresolved", links: {} },
			Ghost: { type: "unresolved", links: {} },
		},
		numLinks: 3,
	});
	const unresolvedLinks = { "A.md": { Projects: 1, Ghost: 1 } };
	const resolve = (t: string) => index.resolve(t);

	it("replaces unresolved folder links with folder nodes", () => {
		const out = applyFolderNodes(make(), { unresolvedLinks, resolve, showFolders: true, folderColor: color });
		expect(out.nodes["A.md"]!.links).toEqual({ Ghost: true, "B.md": true, [folderNodeId("Projects")]: true });
		// The "unresolved" node for [[Projects]] is replaced by the folder node.
		expect(out.nodes[folderNodeId("Projects")]).toEqual({ type: "", links: {}, color });
		expect(out.nodes.Ghost).toEqual({ type: "unresolved", links: {} });
		expect(out.numLinks).toBe(3);
	});

	it("drops folder links without adding nodes when the toggle is off", () => {
		const out = applyFolderNodes(make(), { unresolvedLinks, resolve, showFolders: false, folderColor: color });
		expect(out.nodes["A.md"]!.links).toEqual({ Ghost: true, "B.md": true });
		expect(out.nodes[folderNodeId("Projects")]).toBeUndefined();
		expect(out.nodes.Projects).toBeUndefined();
	});

	it("labels nested folders by name: node id is the folder path", () => {
		const data: GraphData = { nodes: { "A.md": { type: "", links: { work: true } }, work: { type: "unresolved", links: {} } } };
		applyFolderNodes(data, { unresolvedLinks: { "A.md": { work: 1 } }, resolve, showFolders: true, folderColor: color });
		expect(Object.keys(data.nodes).sort()).toEqual(["A.md", "Archive/Work"]);
	});

	it("ignores links from notes not in the (e.g. local) graph", () => {
		const data: GraphData = { nodes: { "B.md": { type: "", links: {} } } };
		applyFolderNodes(data, { unresolvedLinks, resolve, showFolders: true, folderColor: color });
		expect(Object.keys(data.nodes)).toEqual(["B.md"]);
	});
});


describe("folder renames", () => {
	const afterPaths = ["Clients", "Clients/Acme", "Archive", "Archive/Acme", "Notes"];
	const ctxFor = (oldPath: string, newPath: string, notes: string[] = []) => ({
		before: new FolderIndex(foldersBeforeRename(afterPaths, oldPath, newPath)),
		after: new FolderIndex(afterPaths),
		oldPath,
		newPath,
		noteResolves: (t: string) => notes.includes(t),
	});

	it("maps paths through a rename", () => {
		expect(renamedPath("Projects/Acme", "Projects", "Clients")).toBe("Clients/Acme");
		expect(renamedPath("Projects", "Projects", "Clients")).toBe("Clients");
		expect(renamedPath("Projectsville", "Projects", "Clients")).toBeNull();
		expect(foldersBeforeRename(afterPaths, "Projects", "Clients")).toContain("Projects/Acme");
	});

	it("rewrites name links to the new name", () => {
		expect(rewriteFolderLinkpath("Projects", ctxFor("Projects", "Clients"))).toBe("Clients");
	});

	it("rewrites path links to descendants", () => {
		expect(rewriteFolderLinkpath("Projects/Acme", ctxFor("Projects", "Clients"))).toBe("Clients/Acme");
	});

	it("leaves unaffected and still-valid links alone", () => {
		expect(rewriteFolderLinkpath("Notes", ctxFor("Projects", "Clients"))).toBeNull();
	});

	it("uses the full path when the new name is ambiguous", () => {
		// "Old" → "Archive/Acme" exists too, so the renamed "Clients/Acme" needs its path.
		const paths = ["Clients", "Clients/Acme", "Archive", "Archive/Acme"];
		const ctx = {
			before: new FolderIndex(foldersBeforeRename(paths, "Clients/Old", "Clients/Acme")),
			after: new FolderIndex(paths),
			oldPath: "Clients/Old",
			newPath: "Clients/Acme",
			noteResolves: () => false,
		};
		expect(rewriteFolderLinkpath("Old", ctx)).toBe("Clients/Acme");
	});

	it("keeps or adds the trailing slash", () => {
		expect(rewriteFolderLinkpath("Projects/", ctxFor("Projects", "Clients"))).toBe("Clients/");
		expect(rewriteFolderLinkpath("Projects", ctxFor("Projects", "Clients", ["Clients"]))).toBe("Clients/");
	});

	it("replaces link paths in wikilinks and markdown links", () => {
		expect(replaceLinkpath("[[Projects#Plan|my projects]]", "Projects", "Clients")).toBe("[[Clients#Plan|my projects]]");
		expect(replaceLinkpath("![[Projects]]", "Projects", "Clients")).toBe("![[Clients]]");
		expect(replaceLinkpath("[x](My%20Projects)", "My Projects", "Our Clients")).toBe("[x](Our%20Clients)");
		expect(replaceLinkpath("[x](<My Projects>)", "My Projects", "Our Clients")).toBe("[x](<Our Clients>)");
		expect(replaceLinkpath("[[Other]]", "Projects", "Clients")).toBeNull();
	});

	it("applies edits last-first and tolerates shifted offsets", () => {
		const text = "see [[A]] and [[A]]";
		const edits = [
			{ start: 4, end: 9, original: "[[A]]", replacement: "[[Bee]]" },
			{ start: 14, end: 19, original: "[[A]]", replacement: "[[Bee]]" },
		];
		expect(applyTextEdits(text, edits)).toEqual({ text: "see [[Bee]] and [[Bee]]", applied: 2 });
		const shifted = applyTextEdits("XX" + text, edits);
		expect(shifted.text).toBe("XXsee [[Bee]] and [[Bee]]");
		// Only the second link is edited, even though the first is identical and earlier.
		expect(applyTextEdits("XX" + text, [edits[1]!]).text).toBe("XXsee [[A]] and [[Bee]]");
		expect(applyTextEdits("nothing here", edits).applied).toBe(0);
	});
});

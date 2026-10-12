import { describe, expect, it } from "vitest";
import { removeShadowedTemplates } from "../../src/core/templates";
import type { TemplateGroup } from "../../src/core/types";

const group = (folderPath: string, ...names: string[]): TemplateGroup => ({
	folderPath,
	templates: names.map((name) => ({ name, path: `${folderPath}/.osf/templates/${name}.md` })),
});

describe("removeShadowedTemplates", () => {
	it("keeps the nearest template when names collide", () => {
		const out = removeShadowedTemplates([group("A/B", "Meeting"), group("A", "Meeting", "Log"), group("", "Meeting")]);
		expect(out).toEqual([group("A/B", "Meeting"), group("A", "Log")]);
	});

	it("matches names case-insensitively", () => {
		expect(removeShadowedTemplates([group("A/B", "meeting"), group("A", "Meeting")])).toEqual([group("A/B", "meeting")]);
	});

	it("an empty nearer group shadows nothing", () => {
		expect(removeShadowedTemplates([group("A/B"), group("A", "Log")])).toEqual([group("A", "Log")]);
	});

	it("a shadowed parent still shadows the grandparent", () => {
		// B overrides A's "X"; root's "X" must stay hidden too.
		expect(removeShadowedTemplates([group("A/B", "X"), group("A", "X"), group("", "X", "Y")])).toEqual([
			group("A/B", "X"),
			group("", "Y"),
		]);
	});
});

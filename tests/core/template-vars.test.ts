import { describe, expect, it } from "vitest";
import { applyTemplateVars } from "../../src/core/template-vars";

// Fake formatter: echoes the format so tests don't depend on moment or the clock.
const ctx = { title: "My Note", now: new Date(0), formatDate: (_d: Date, f: string) => `<${f}>` };

describe("applyTemplateVars", () => {
	it("substitutes title, date and time with defaults", () => {
		expect(applyTemplateVars("# {{title}}\n{{date}} {{time}}", ctx)).toBe("# My Note\n<YYYY-MM-DD> <HH:mm>");
	});

	it("passes custom formats through, trimmed", () => {
		expect(applyTemplateVars("{{date:dddd D MMM}} {{ time : HH:mm:ss }}", ctx)).toBe("<dddd D MMM> <HH:mm:ss>");
	});

	it("is case-insensitive and leaves unknown vars and Templater syntax alone", () => {
		expect(applyTemplateVars("{{TITLE}} {{other}} <% tp.date.now() %>", ctx)).toBe(
			"My Note {{other}} <% tp.date.now() %>",
		);
	});
});

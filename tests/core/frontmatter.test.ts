import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { FrontmatterParseError, parseFrontmatter, serializeFrontmatter } from "../../src/core/frontmatter";
import type { YamlCodec } from "../../src/core/types";

const codec: YamlCodec = { parse, stringify };

describe("parseFrontmatter", () => {
	it("treats empty text as no properties", () => {
		expect(parseFrontmatter("", codec)).toEqual({});
		expect(parseFrontmatter("  \n", codec)).toEqual({});
	});

	it("parses a mapping", () => {
		expect(parseFrontmatter("status: active\ntags: [a, b]\n", codec)).toEqual({
			status: "active",
			tags: ["a", "b"],
		});
	});

	it("rejects non-mapping top levels", () => {
		expect(() => parseFrontmatter("- a\n- b\n", codec)).toThrow(FrontmatterParseError);
		expect(() => parseFrontmatter("just a string", codec)).toThrow(FrontmatterParseError);
	});

	it("rejects invalid YAML", () => {
		expect(() => parseFrontmatter("a: [unclosed", codec)).toThrow(FrontmatterParseError);
	});
});

describe("serializeFrontmatter", () => {
	it("round-trips", () => {
		const fm = { status: "active", count: 3 };
		expect(parseFrontmatter(serializeFrontmatter(fm, codec), codec)).toEqual(fm);
	});

	it("serialises empty as empty string", () => {
		expect(serializeFrontmatter({}, codec)).toBe("");
	});
});

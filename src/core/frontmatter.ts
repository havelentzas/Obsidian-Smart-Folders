/** Parse/serialise folder frontmatter. NO obsidian imports — unit-tested. */

import type { FolderFrontmatter, YamlCodec } from "./types";

export class FrontmatterParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FrontmatterParseError";
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse frontmatter.yaml text. Empty/whitespace-only text is an empty object.
 * Throws FrontmatterParseError if the YAML is invalid or its top level is not a mapping
 * (a folder's properties must be key/value pairs, like a note's frontmatter).
 */
export function parseFrontmatter(text: string, codec: YamlCodec): FolderFrontmatter {
	if (text.trim() === "") return {};
	let parsed: unknown;
	try {
		parsed = codec.parse(text);
	} catch (err) {
		throw new FrontmatterParseError(`Invalid YAML: ${(err as Error).message}`);
	}
	if (parsed === null || parsed === undefined) return {};
	if (!isPlainObject(parsed)) {
		throw new FrontmatterParseError("Folder frontmatter must be a YAML mapping (key: value pairs).");
	}
	return parsed;
}

/** Serialise properties to YAML. An empty object becomes an empty string. */
export function serializeFrontmatter(frontmatter: FolderFrontmatter, codec: YamlCodec): string {
	if (Object.keys(frontmatter).length === 0) return "";
	const out = codec.stringify(frontmatter);
	return out.endsWith("\n") ? out : out + "\n";
}

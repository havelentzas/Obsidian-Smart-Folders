/**
 * Core-Templates-style variable substitution, used when Templater is NOT enabled.
 * Supports {{title}}, {{date}}, {{time}}, {{date:FORMAT}}, {{time:FORMAT}} (moment formats).
 * NO obsidian imports — the date formatter is injected (moment in the plugin).
 */

export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
export const DEFAULT_TIME_FORMAT = "HH:mm";

export interface TemplateVarContext {
	/** New note's name without extension. */
	title: string;
	now: Date;
	formatDate: (date: Date, format: string) => string;
}

const VAR_PATTERN = /{{\s*(title|date|time)\s*(?::([^}]*))?}}/gi;

export function applyTemplateVars(content: string, ctx: TemplateVarContext): string {
	return content.replace(VAR_PATTERN, (_match, name: string, format: string | undefined) => {
		const fmt = format?.trim();
		switch (name.toLowerCase()) {
			case "title":
				return ctx.title;
			case "date":
				return ctx.formatDate(ctx.now, fmt || DEFAULT_DATE_FORMAT);
			default:
				return ctx.formatDate(ctx.now, fmt || DEFAULT_TIME_FORMAT);
		}
	});
}

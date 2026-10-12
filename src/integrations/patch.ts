/**
 * Minimal method patching for Obsidian internals, safe to undo even if another plugin
 * patched the same method after us (we then go inert instead of clobbering their wrapper).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

/**
 * Replace `target[key]` with `wrap(original)`. Returns an uninstaller.
 * The wrapper receives the original bound to the same `this`.
 */
export function patchMethod<T extends object>(
	target: T,
	key: string,
	wrap: (original: AnyFn) => AnyFn,
): () => void {
	const record = target as Record<string, unknown>;
	const original = record[key];
	if (typeof original !== "function") return () => {};
	let active = true;
	const patched = wrap(original as AnyFn);
	const wrapper = function (this: unknown, ...args: unknown[]) {
		return active ? patched.apply(this, args) : (original as AnyFn).apply(this, args);
	};
	record[key] = wrapper;
	return () => {
		active = false;
		if (record[key] === wrapper) record[key] = original;
	};
}

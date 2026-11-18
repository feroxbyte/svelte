/** @import { ComponentContext, Derived, Reaction, Value } from '#client' */
import { UNINITIALIZED } from '../../../constants.js';
import { snapshot } from '../../shared/clone.js';
import { DERIVED, ASYNC, PROXY_PATH_SYMBOL, STATE_SYMBOL } from '#client/constants';
import { effect_tracking } from '../reactivity/effects.js';
import { active_reaction, untrack } from '../runtime.js';
import { component_context } from '../context.js';
import { announce_signal, hooks } from './devtools.js';

/**
 * @typedef {{
 *   traces: Error[];
 * }} TraceEntry
 */

/** @type {{ reaction: Reaction | null, entries: Map<Value, TraceEntry> } | null} */
export let tracing_expressions = null;

/**
 * @param {Value} signal
 * @param {TraceEntry} [entry]
 */
function log_entry(signal, entry) {
	const value = signal.v;

	if (value === UNINITIALIZED) {
		return;
	}

	const type = get_type(signal);
	const current_reaction = /** @type {Reaction} */ (active_reaction);
	const dirty = signal.wv > current_reaction.wv || current_reaction.wv === 0;
	const style = dirty
		? 'color: CornflowerBlue; font-weight: bold'
		: 'color: grey; font-weight: normal';

	// eslint-disable-next-line no-console
	console.groupCollapsed(
		signal.label ? `%c${type}%c ${signal.label}` : `%c${type}%c`,
		style,
		dirty ? 'font-weight: normal' : style,
		typeof value === 'object' && value !== null && STATE_SYMBOL in value
			? snapshot(value, true)
			: value
	);

	if (type === '$derived') {
		const deps = new Set(/** @type {Derived} */ (signal).deps);
		for (const dep of deps) {
			log_entry(dep);
		}
	}

	if (signal.created) {
		// eslint-disable-next-line no-console
		console.log(signal.created);
	}

	if (dirty && signal.updated) {
		for (const updated of signal.updated.values()) {
			if (updated.error) {
				// eslint-disable-next-line no-console
				console.log(updated.error);
			}
		}
	}

	if (entry) {
		for (var trace of entry.traces) {
			// eslint-disable-next-line no-console
			console.log(trace);
		}
	}

	// eslint-disable-next-line no-console
	console.groupEnd();
}

/**
 * @param {Value} signal
 * @returns {'$state' | '$derived' | 'store'}
 */
function get_type(signal) {
	if ((signal.f & (DERIVED | ASYNC)) !== 0) return '$derived';
	return signal.label?.startsWith('$') ? 'store' : '$state';
}

/**
 * @template T
 * @param {() => string} label
 * @param {() => T} fn
 */
export function trace(label, fn) {
	var previously_tracing_expressions = tracing_expressions;

	try {
		tracing_expressions = { entries: new Map(), reaction: active_reaction };

		var start = performance.now();
		var value = fn();
		var time = (performance.now() - start).toFixed(2);

		var prefix = untrack(label);

		if (!effect_tracking()) {
			// eslint-disable-next-line no-console
			console.log(`${prefix} %cran outside of an effect (${time}ms)`, 'color: grey');
		} else if (tracing_expressions.entries.size === 0) {
			// eslint-disable-next-line no-console
			console.log(`${prefix} %cno reactive dependencies (${time}ms)`, 'color: grey');
		} else {
			// eslint-disable-next-line no-console
			console.group(`${prefix} %c(${time}ms)`, 'color: grey');

			var entries = tracing_expressions.entries;

			untrack(() => {
				for (const [signal, traces] of entries) {
					log_entry(signal, traces);
				}
			});

			tracing_expressions = null;

			// eslint-disable-next-line no-console
			console.groupEnd();
		}

		return value;
	} finally {
		tracing_expressions = previously_tracing_expressions;
	}
}

/**
 * @template {Value} T
 * @param {T} source
 * @param {string} label
 * @param {string} [location] `file:line:column` of the declaration
 * @returns {T}
 */
export function tag(source, label, location) {
	label_source(source, label, location);
	tag_proxy(source.v, label, location);

	return source;
}

/**
 * Like `tag`, but doesn't relabel the proxy stored in the source (if any)
 * @template {Value} T
 * @param {T} source
 * @param {string} label
 * @param {string} [location]
 * @param {object} [proxy] the `$state` proxy owning this source, if any
 * @param {PropertyKey} [key] the property of `proxy` this source stores (`undefined` for the version source)
 * @param {ComponentContext | null} [ctx] the component the source was declared in
 * @returns {T}
 */
export function label_source(source, label, location, proxy, key, ctx) {
	source.label = label;

	if (location !== undefined) {
		source.location = location;
	}

	if (hooks.signalCreated !== null) {
		announce_signal(source, label, source.location, proxy, key, ctx);
	}

	return source;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {string} [location]
 * @param {ComponentContext | null} [ctx] the component the proxy was declared in
 */
export function tag_proxy(value, label, location, ctx = component_context) {
	// @ts-expect-error
	value?.[PROXY_PATH_SYMBOL]?.(label, location, ctx);
	return value;
}

/**
 * @param {unknown} value
 */
export function label(value) {
	if (typeof value === 'symbol') return `Symbol(${value.description})`;
	if (typeof value === 'function') return '<function>';
	if (typeof value === 'object' && value) return '<object>';
	return String(value);
}

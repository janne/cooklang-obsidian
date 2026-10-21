/**
 * Pure servings-scaling math used by the scaler bar and CookView.
 */

// `@cooklang/cooklang` does not re-export its `Servings` type, so mirror it
// locally (it is `number | string`).
type Servings = number | string;

export interface RecipeReferenceScaleRequest {
    quantity: number;
    unit: string | null;
}

/** Numeric base servings from recipe metadata, defaulting to one when omitted. */
export function parseServingsValue(servings: Servings | undefined): number | null {
    if (servings === undefined) return 1;
    if (typeof servings === 'number') {
        return servings > 0 ? servings : null;
    }
    if (typeof servings === 'string') {
        const match = servings.match(/^\s*(\d+(?:\.\d+)?)/);
        if (match) {
            const n = parseFloat(match[1]);
            if (n > 0) return n;
        }
    }
    return null;
}

/** Scale factor to pass to the parser: target / base. */
export function computeScale(targetServings: number, baseServings: number): number {
    if (baseServings <= 0) return 1;
    return targetServings / baseServings;
}

interface ParsedYield {
    quantity: number;
    unit: string;
}

function parseYieldEntry(value: unknown): ParsedYield | null {
    if (typeof value !== 'string') return null;
    const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*(?:%|\s)\s*(\S.*?)\s*$/);
    if (!match) return null;
    const quantity = Number(match[1]);
    return quantity > 0
        ? { quantity, unit: match[2].trim() }
        : null;
}

/** `yield` is one `number%unit` value or a list of them (`[500%ml, 350%g]`). */
function parseYieldValues(value: unknown): ParsedYield[] {
    if (Array.isArray(value)) return value.map(parseYieldEntry).filter((entry): entry is ParsedYield => entry !== null);
    if (typeof value === 'string' && /^\s*\[.*\]\s*$/.test(value)) {
        return parseYieldValues(value.trim().slice(1, -1).split(','));
    }
    const entry = parseYieldEntry(value);
    return entry ? [entry] : [];
}

function normalizedUnit(unit: string): string {
    return unit.trim().toLowerCase().replace(/s$/, '');
}

export type ReferenceScaleResult =
    | { ok: true; factor: number }
    | { ok: false; reason: string };

/**
 * Scale factor for a referenced recipe, following the Cooklang conventions:
 * no unit multiplies the recipe, `%servings` divides by the target's servings
 * (default 1), and any other unit must match one of the target's `yield`
 * entries; otherwise the reference is an error.
 * https://cooklang.org/docs/conventions/#scaling-referenced-recipes
 */
export function resolveReferenceScale(
    request: RecipeReferenceScaleRequest | null,
    servings: Servings | null | undefined,
    yieldValue: unknown,
): ReferenceScaleResult {
    if (!request) return { ok: true, factor: 1 };
    if (!Number.isFinite(request.quantity) || request.quantity <= 0) {
        return { ok: false, reason: 'the reference quantity is not a positive number' };
    }
    if (!request.unit?.trim()) return { ok: true, factor: request.quantity };

    if (normalizedUnit(request.unit) === 'serving') {
        // The parser reports absent servings as null; recipes default to one serving.
        const baseServings = parseServingsValue(servings ?? undefined);
        return baseServings === null
            ? { ok: false, reason: 'the recipe has no numeric servings' }
            : { ok: true, factor: computeScale(request.quantity, baseServings) };
    }

    const unit = normalizedUnit(request.unit);
    const match = parseYieldValues(yieldValue).find(entry => normalizedUnit(entry.unit) === unit);
    return match
        ? { ok: true, factor: request.quantity / match.quantity }
        : { ok: false, reason: `the recipe has no yield in ${request.unit.trim()}` };
}

/** Lenient variant for opening a reference: unresolved requests open the recipe as written. */
export function computeReferenceScale(
    request: RecipeReferenceScaleRequest | null,
    servings: Servings | null | undefined,
    yieldValue: unknown,
): number {
    const result = resolveReferenceScale(request, servings, yieldValue);
    return result.ok ? result.factor : 1;
}

/** Clamp a servings count within sane bounds without discarding fractions. */
export function clampServings(value: number, min = 1, max = 1000): number {
    return Math.max(min, Math.min(max, value));
}

export interface ServingsState {
    /** Unscaled base servings from recipe metadata, or null when not numeric. */
    baseServings: number | null;
    /** Servings shown to the user at the current scale, or null when no base. */
    displayServings: number | null;
}

/**
 * Derive the servings shown in the scaler from the UNSCALED base servings and
 * the current scale.
 *
 * `baseServings` must come from a scale-1 parse: the Cooklang parser scales (and
 * rounds) the `servings` metadata, so reading servings off a recipe parsed at
 * `scale` and multiplying by `scale` again squares the factor — the bug behind
 * issue #83 (×4 only doubled quantities, and targets like ×2/×6 were skipped).
 */
export function deriveServingsState(baseServings: number | null, scale: number): ServingsState {
    if (baseServings == null) return { baseServings: null, displayServings: null };
    return { baseServings, displayServings: clampServings(baseServings * scale) };
}

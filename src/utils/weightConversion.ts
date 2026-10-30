/**
 * Volume-to-weight conversion driven by a user-maintained YAML table.
 *
 * Table format (top-level keys are ingredient names, matched case-insensitively):
 *
 *   couscous:
 *     grams_per_100ml: 73  # converts any volume unit
 *   currypasta:
 *     grams_per_100ml: 101
 *     aliases:
 *     - röd currypasta
 *
 * The file may be a Markdown note; ``` fence lines around the YAML are ignored.
 *
 * Mass units (oz, lb, kg, ...) convert to grams without a table entry.
 * Results are rounded to whole grams. Pure so it runs under Node-based Vitest.
 */

import {
    addDependencies,
    create,
    createUnitDependencies,
    unitDependencies,
    type Unit,
} from 'mathjs';

export type MeasureMode = 'volume' | 'weight';

export interface WeightTable {
    /** Grams per millilitre, keyed by normalized ingredient name and alias. */
    entries: Map<string, number>;
}

export interface WeightTableParseResult {
    table: WeightTable;
    errors: string[];
}

export interface WeightConverter {
    /** Whole grams for an amount of the first matching name, or null when unknown. */
    toGrams(names: string[], value: number, unit: string | null): number | null;
    /** True when the unit is already a mass unit. */
    isMass(unit: string | null): boolean;
}

const unitMath = create({ addDependencies, createUnitDependencies, unitDependencies });
unitMath.createUnit('tbsp', { definition: '1 tablespoon', aliases: ['tbs'] });
unitMath.createUnit('tsp', '1 teaspoon');
// Swedish kitchen measures.
unitMath.createUnit('msk', '15 ml');
unitMath.createUnit('tsk', '5 ml');
unitMath.createUnit('krm', '1 ml');

const GRAM = unitMath.unit('g');
const MILLILITRE = unitMath.unit('ml');

/** Case matters only where lowercasing changes meaning (T = tablespoon, t = tonne). */
const CASE_SENSITIVE_UNITS: Record<string, string> = { T: 'tbsp', t: 'tsp' };
const UNIT_ALIASES: Record<string, string> = { 'fl oz': 'floz', 'fl. oz.': 'floz' };

/** Paths to try for a configured weights file; like a wikilink, ".md" may be omitted. */
export function weightsFileCandidates(path: string): string[] {
    const trimmed = path.trim().replace(/^\/+/, '');
    if (!trimmed) return [];
    return trimmed.toLowerCase().endsWith('.md') ? [trimmed] : [trimmed, `${trimmed}.md`];
}

/** The YAML text of a weights file, ignoring any ``` or ~~~ fence lines around it. */
export function weightsYamlSource(text: string): string {
    return text.split(/\r?\n/).filter(line => !/^[ \t]*(`{3,}|~{3,})/.test(line)).join('\n');
}

/** Whole grams for display: "250 g", or kilograms from 1000 g ("1 kg", "1.234 kg"). */
export function formatGrams(grams: number): string {
    const rounded = Math.round(grams);
    return rounded >= 1000 ? `${rounded / 1000} kg` : `${rounded} g`;
}

/** A gram range in one unit when both ends share it: "200–300 g", "1–1.5 kg", "800 g–1.2 kg". */
export function formatGramRange(start: number, end: number): string {
    const [a, b] = [Math.round(start), Math.round(end)];
    if (a === b) return formatGrams(a);
    if (a >= 1000) return `${a / 1000}–${b / 1000} kg`;
    if (b < 1000) return `${a}–${b} g`;
    return `${formatGrams(a)}–${formatGrams(b)}`;
}

export function normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function positiveNumber(value: unknown): number | null {
    const n = typeof value === 'string' && value.trim() ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function emptyWeightTable(): WeightTable {
    return { entries: new Map() };
}

/** Builds a table from parsed YAML. Invalid entries are skipped and reported. */
export function parseWeightTable(data: unknown): WeightTableParseResult {
    const table = emptyWeightTable();
    const errors: string[] = [];
    if (data == null) return { table, errors };
    if (!isPlainObject(data)) {
        return { table, errors: ['The weights file must be a map of ingredient names.'] };
    }

    for (const [rawName, value] of Object.entries(data)) {
        const name = normalizeName(rawName);
        if (!name) continue;
        const per100 = isPlainObject(value) ? positiveNumber(value.grams_per_100ml) : null;
        if (!isPlainObject(value) || per100 === null) {
            errors.push(`${rawName}: grams_per_100ml must be a positive number.`);
            continue;
        }
        const list = Array.isArray(value.aliases) ? value.aliases : [value.aliases];
        const aliases = list.filter((alias): alias is string => typeof alias === 'string');
        for (const key of [name, ...aliases.map(normalizeName)]) {
            if (key) table.entries.set(key, per100 / 100);
        }
    }
    return { table, errors };
}

function parseUnit(value: number, unit: string | null): Unit | null {
    const trimmed = unit?.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    try {
        return unitMath.unit(value, CASE_SENSITIVE_UNITS[trimmed] ?? UNIT_ALIASES[lower] ?? lower);
    } catch {
        return null;
    }
}

/** Plural-tolerant lookup: "beans" finds "bean", "tomatoes" finds "tomato". */
function lookup<V>(map: Map<string, V>, key: string): V | undefined {
    return map.get(key)
        ?? (key.endsWith('es') ? map.get(key.slice(0, -2)) : undefined)
        ?? (key.endsWith('s') ? map.get(key.slice(0, -1)) : undefined);
}

export function createWeightConverter(table: WeightTable): WeightConverter {
    const isMass = (unit: string | null): boolean => parseUnit(1, unit)?.equalBase(GRAM) ?? false;

    return {
        isMass,
        toGrams(names, value, unit) {
            if (!Number.isFinite(value) || value <= 0) return null;
            const parsed = parseUnit(value, unit);
            let grams: number | null = null;
            if (parsed?.equalBase(GRAM)) {
                grams = parsed.toNumber('g');
            } else if (parsed?.equalBase(MILLILITRE)) {
                const gramsPerMl = names.map(name => lookup(table.entries, normalizeName(name)))
                    .find((candidate): candidate is number => candidate !== undefined);
                if (gramsPerMl !== undefined) grams = parsed.toNumber('ml') * gramsPerMl;
            }
            if (grams === null) return null;
            const rounded = Math.round(grams);
            // "0 g" is less useful than the original small measure.
            return rounded > 0 ? rounded : null;
        },
    };
}

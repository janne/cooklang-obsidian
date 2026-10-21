/**
 * Menu (meal plan) view model.
 *
 * A `.menu` file is ordinary Cooklang: each section is a day, and each step is
 * a meal whose lines are joined with `\` continuations, e.g.
 *
 *     == Day 1 (2026-03-07) ==
 *     Breakfast: \
 *     - @./Breakfast/Granola{2%servings} with @yogurt{200%g}
 *
 * This shapes parsed sections into days and meals. Pure — no WASM/Obsidian runtime.
 */
import { formatQuantity, type RecipeRefTarget } from './ingredientAggregator';
import type { SectionView, StepPart } from './sectionHelpers';

export type MenuEntry =
    | { type: 'meal'; label: string | null; lines: StepPart[][] }
    | { type: 'note'; note: string };

export interface MenuDay {
    /** Section name without its date, or null for content before any section. */
    title: string | null;
    /** ISO `YYYY-MM-DD` date from a `Day (2026-03-07)` section name. */
    date: string | null;
    isToday: boolean;
    entries: MenuEntry[];
}

const DATED_SECTION = /^(.*?)\s*\((\d{4}-\d{2}-\d{2})\)\s*$/;
const MEAL_LABEL = /^\s*([^:\n]+?)\s*:\s*$/;

/** Local calendar date, matching how people write plan dates. */
export function localDateKey(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDayName(name: string | null): { title: string | null; date: string | null } {
    if (!name) return { title: null, date: null };
    const match = DATED_SECTION.exec(name);
    return match ? { title: match[1] || null, date: match[2] } : { title: name, date: null };
}

/** Split step parts at newlines and drop list bullets and blank lines. */
export function splitMealLines(parts: StepPart[]): StepPart[][] {
    const lines: StepPart[][] = [[]];
    for (const part of parts) {
        if (part.type !== 'text') {
            lines[lines.length - 1].push(part);
            continue;
        }
        part.value.split('\n').forEach((segment, index) => {
            if (index > 0) lines.push([]);
            if (segment) lines[lines.length - 1].push({ type: 'text', value: segment });
        });
    }
    return lines.map(trimLine).filter(line => line.length > 0);
}

function trimLine(line: StepPart[]): StepPart[] {
    const result = [...line];
    const first = result[0];
    if (first?.type === 'text') {
        const value = first.value.replace(/^\s*(?:[-*+]\s+|[-*+]$)?/, '');
        if (value) result[0] = { type: 'text', value };
        else result.shift();
    }
    const last = result[result.length - 1];
    if (last?.type === 'text') {
        const value = last.value.trimEnd();
        if (value) result[result.length - 1] = { type: 'text', value };
        else result.pop();
    }
    return result;
}

function mealLabel(line: StepPart[] | undefined): string | null {
    if (!line || line.length !== 1 || line[0].type !== 'text') return null;
    return MEAL_LABEL.exec(line[0].value)?.[1] ?? null;
}

export function buildMenuDays(sections: SectionView[], today: string): MenuDay[] {
    return sections
        .map(section => {
            const { title, date } = parseDayName(section.name);
            const entries: MenuEntry[] = section.entries.map(entry => {
                if (entry.type === 'note') return entry;
                const lines = splitMealLines(entry.step.parts);
                const label = mealLabel(lines[0]);
                return { type: 'meal', label, lines: label === null ? lines : lines.slice(1) };
            });
            return { title, date, isToday: date === today, entries };
        })
        .filter(day => day.title !== null || day.entries.length > 0);
}

/**
 * The reference a menu item opens. Quantities come from the plan-scaled parse,
 * so `{2}` and `{6%servings}` already include the plan scale; an empty `{}` has
 * no quantity for the parser to scale, so the plan scale becomes its multiplier.
 */
export function menuReferenceTarget(
    reference: { name: string; components?: string[] },
    quantity: { value: number; unit: string | null } | null,
    planScale: number,
): RecipeRefTarget {
    return {
        name: reference.name,
        components: reference.components ?? [],
        quantity: quantity?.value ?? (planScale !== 1 ? planScale : null),
        unit: quantity ? quantity.unit : null,
    };
}

/** `×2` for a multiplier, `6 servings` for a unit request, nothing for the recipe as written. */
export function menuReferenceAmount(target: RecipeRefTarget): string | null {
    if (target.quantity === null) return null;
    const amount = formatQuantity(target.quantity);
    return target.unit?.trim() ? `${amount} ${target.unit.trim()}` : `×${amount}`;
}


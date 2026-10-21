/**
 * Combined ingredients for a menu (CookCLI `shopping-list` style, read-only).
 *
 * Referenced recipes are expanded recursively. Each reference resolves to a
 * factor using the Cooklang conventions (`{2}` doubles, `{6%servings}` divides
 * by the target's servings, other units match its `yield`). Factors multiply
 * through nesting, and the menu's own scale multiplies everything. Optional
 * items (`@?`) are kept apart and their references are not expanded.
 *
 * Pure: parsing, vault reads and reference resolution are injected.
 */
import type { CooklangRecipe, Ingredient } from '@cooklang/cooklang';
import { ingredient_should_be_listed } from '../recipeHelpers';
import { aggregateIngredients, type AggInput, type IngredientRow, type RecipeRefTarget } from './ingredientAggregator';
import { ingredientToAggInput } from './ingredientRows';
import { resolveReferenceScale } from './scaling';

export type CombinedRecipe = Pick<CooklangRecipe, 'ingredients' | 'servings' | 'rawMetadata'>;

export interface CombinedIngredientsDeps {
    parse(source: string, scale: number): CombinedRecipe;
    read(path: string): Promise<string>;
    /** Vault path of a referenced recipe, or null when it does not exist. */
    resolve(reference: RecipeRefTarget, fromPath: string): string | null;
}

export interface CombinedIngredientProblem {
    name: string;
    reason: string;
}

export interface CombinedIngredients {
    rows: IngredientRow[];
    optional: IngredientRow[];
    problems: CombinedIngredientProblem[];
    /** Every recipe file read, for invalidation when one changes. */
    dependencies: string[];
}

export const MAX_REFERENCE_DEPTH = 8;

function isOptional(ingredient: Ingredient): boolean {
    return /\bOPT\b/.test(ingredient.modifiers ?? '');
}

function referenceDisplayName(reference: RecipeRefTarget): string {
    return [...reference.components.filter(part => part && part !== '.'), reference.name].join('/');
}

export async function buildCombinedIngredients(
    path: string,
    source: string,
    scale: number,
    deps: CombinedIngredientsDeps,
): Promise<CombinedIngredients> {
    const items: AggInput[] = [];
    const optional: AggInput[] = [];
    const problems: CombinedIngredientProblem[] = [];
    const dependencies = new Set<string>();
    const sources = new Map<string, Promise<string>>();

    const read = (target: string): Promise<string> => {
        let pending = sources.get(target);
        if (!pending) {
            pending = deps.read(target);
            sources.set(target, pending);
        }
        return pending;
    };

    const visit = async (currentPath: string, text: string, factor: number, stack: string[]): Promise<void> => {
        // Reference requests come from the unscaled parse; the factor already carries the parent's scale.
        const base = deps.parse(text, 1);
        const scaled = factor === 1 ? base : deps.parse(text, factor);

        for (const [index, ingredient] of base.ingredients.entries()) {
            if (!ingredient_should_be_listed(ingredient)) continue;
            const scaledInput = ingredientToAggInput(scaled.ingredients[index] ?? ingredient);
            if (isOptional(ingredient)) {
                optional.push(scaledInput);
                continue;
            }
            const request = ingredientToAggInput(ingredient).reference;
            if (!request) {
                items.push(scaledInput);
                continue;
            }

            const name = referenceDisplayName(request);
            const target = deps.resolve(request, currentPath);
            if (!target) {
                problems.push({ name, reason: 'recipe not found' });
                continue;
            }
            if (stack.includes(target)) {
                problems.push({ name, reason: 'recipe references itself' });
                continue;
            }
            if (stack.length > MAX_REFERENCE_DEPTH) {
                problems.push({ name, reason: 'references are nested too deeply' });
                continue;
            }

            let childSource: string;
            try {
                childSource = await read(target);
            } catch {
                problems.push({ name, reason: 'recipe could not be read' });
                continue;
            }
            dependencies.add(target);
            const child = deps.parse(childSource, 1);
            const result = resolveReferenceScale(
                request.quantity === null ? null : { quantity: request.quantity, unit: request.unit },
                child.servings,
                child.rawMetadata.get('yield'),
            );
            if (!result.ok) {
                problems.push({ name, reason: result.reason });
                continue;
            }
            await visit(target, childSource, factor * result.factor, [...stack, target]);
        }
    };

    await visit(path, source, scale, [path]);
    return {
        rows: aggregateIngredients(items),
        optional: aggregateIngredients(optional),
        problems,
        dependencies: [...dependencies],
    };
}

import type { CooklangRecipe, Ingredient } from '@cooklang/cooklang';
import type { CooklangSettings } from '../settings';
import {
    ingredient_display_name,
    ingredient_should_be_listed,
    quantity_display,
} from '../recipeHelpers';
import {
    aggregateIngredients,
    type AggInput,
    type IngredientRow,
} from './ingredientAggregator';
import { buildSectionGroups } from './ingredientSectionGroups';
import { numericFromQuantity, rangeFromQuantity } from './quantityValue';
import { getSections, hasNamedSections } from './sectionHelpers';
import type { WeightConverter } from './weightConversion';

/** The converter for one ingredient (by display name), or null to show it as written. */
export type WeightsFor = (ingredientName: string) => WeightConverter | null;

export interface IngredientDisplayGroup {
    name: string | null;
    rows: IngredientRow[];
}

function weightNames(ingredient: Ingredient): string[] {
    return [ingredient_display_name(ingredient), ingredient.name];
}

/** Whole grams for an ingredient's numeric amount, or null when it can't be weighed. */
export function ingredientGrams(ingredient: Ingredient, weights: WeightConverter | null): number | null {
    const quantity = ingredient.quantity;
    if (!weights || !quantity || ingredient.reference) return null;
    const numeric = numericFromQuantity(quantity);
    return numeric === null ? null
        : weights.toGrams(weightNames(ingredient), numeric, quantity.unit ?? null);
}

/** "200–300 g" for a range amount when both ends can be weighed, else null. */
export function ingredientGramRangeText(ingredient: Ingredient, weights: WeightConverter | null): string | null {
    const quantity = ingredient.quantity;
    if (!weights || !quantity || ingredient.reference) return null;
    const range = rangeFromQuantity(quantity);
    if (!range) return null;
    const unit = quantity.unit ?? null;
    const start = weights.toGrams(weightNames(ingredient), range.start, unit);
    const end = weights.toGrams(weightNames(ingredient), range.end, unit);
    if (start === null || end === null) return null;
    return start === end ? `${start} g` : `${start}–${end} g`;
}

/** Inline quantity text, shown in grams when a weight converter applies. */
export function ingredientQuantityDisplay(ingredient: Ingredient, weights: WeightConverter | null): string {
    const grams = ingredientGrams(ingredient, weights);
    if (grams !== null) return `${grams} g`;
    return ingredientGramRangeText(ingredient, weights)
        ?? (ingredient.quantity ? quantity_display(ingredient.quantity) : '');
}

/** Display names of listed ingredients whose amount weight mode would change. */
export function weightConvertibleNames(recipe: CooklangRecipe, weights: WeightConverter | null): Set<string> {
    const names = new Set<string>();
    if (!weights) return names;
    for (const ingredient of recipe.ingredients) {
        if (ingredient_should_be_listed(ingredient)
            && !weights.isMass(ingredient.quantity?.unit ?? null)
            && (ingredientGrams(ingredient, weights) !== null || ingredientGramRangeText(ingredient, weights) !== null)) {
            names.add(ingredient_display_name(ingredient));
        }
    }
    return names;
}

/** True when weight mode would change at least one listed amount. */
export function recipeHasWeightConversions(recipe: CooklangRecipe, weights: WeightConverter | null): boolean {
    return weightConvertibleNames(recipe, weights).size > 0;
}

export function ingredientToAggInput(ingredient: Ingredient, weights: WeightConverter | null = null): AggInput {
    const quantity = ingredient.quantity;
    let quantityValue: number | null = null;
    let unit: string | null = null;
    let quantityText: string | null = null;

    if (quantity) {
        const numeric = numericFromQuantity(quantity);
        if (numeric !== null) {
            quantityValue = numeric;
            unit = quantity.unit ?? null;
        } else {
            quantityText = ingredientGramRangeText(ingredient, weights) ?? quantity_display(quantity);
        }
    }

    const reference = ingredient.reference
        ? {
            name: ingredient.reference.name,
            components: ingredient.reference.components ?? [],
            quantity: quantityValue,
            unit,
        }
        : null;
    const grams = ingredientGrams(ingredient, weights);

    return {
        name: ingredient_display_name(ingredient),
        quantityValue: grams ?? quantityValue,
        unit: grams !== null ? 'g' : unit,
        quantityText,
        note: ingredient.note ?? null,
        reference,
    };
}

export function buildIngredientDisplayGroups(
    recipe: CooklangRecipe,
    settings: CooklangSettings,
    weightsFor: WeightsFor = () => null,
): IngredientDisplayGroup[] {
    const toInput = (ingredient: Ingredient): AggInput =>
        ingredientToAggInput(ingredient, weightsFor(ingredient_display_name(ingredient)));

    if (!settings.showIngredientList) return [];

    const inputForIndex = (index: number): AggInput | null => {
        const ingredient = recipe.ingredients[index];
        return ingredient && ingredient_should_be_listed(ingredient)
            ? toInput(ingredient)
            : null;
    };

    if (settings.groupIngredientsBySection) {
        const sections = getSections(recipe);
        if (hasNamedSections(sections)) {
            return buildSectionGroups(sections, inputForIndex);
        }
    }

    const rows = aggregateIngredients(
        recipe.ingredients
            .filter(ingredient => ingredient_should_be_listed(ingredient))
            .map(toInput),
    );
    return rows.length ? [{ name: null, rows }] : [];
}

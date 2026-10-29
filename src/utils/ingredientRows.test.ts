import { describe, expect, it, vi } from 'vitest';
import type { CooklangRecipe, Ingredient } from '@cooklang/cooklang';
import {
    buildIngredientDisplayGroups,
    ingredientQuantityDisplay,
    recipeHasWeightConversions,
} from './ingredientRows';
import { createWeightConverter, parseWeightTable } from './weightConversion';
import type { CooklangSettings } from '../settings';

vi.mock('@cooklang/cooklang', () => ({
    ingredient_should_be_listed: () => true,
    ingredient_display_name: (ingredient: { name: string }) => ingredient.name,
    quantity_display: (quantity: { display?: string }) => quantity.display ?? '',
}));

function ingredient(name: string, value: number, unit: string | null, extra: Partial<Ingredient> = {}): Ingredient {
    return {
        name,
        note: null,
        reference: null,
        quantity: {
            value: { type: 'number', value: { type: 'regular', value } },
            unit,
            display: unit ? `${value} ${unit}` : String(value),
        },
        ...extra,
    } as unknown as Ingredient;
}

function rangeIngredient(name: string, start: number, end: number, unit: string | null): Ingredient {
    return {
        name,
        note: null,
        reference: null,
        quantity: {
            value: { type: 'range', value: { start: { type: 'regular', value: start }, end: { type: 'regular', value: end } } },
            unit,
            display: `${start}-${end}${unit ? ` ${unit}` : ''}`,
        },
    } as unknown as Ingredient;
}

function recipe(ingredients: Ingredient[]): CooklangRecipe {
    return { ingredients, sections: [] } as unknown as CooklangRecipe;
}

const settings = { showIngredientList: true, groupIngredientsBySection: false } as CooklangSettings;
const weights = createWeightConverter(parseWeightTable({ flour: { grams_per_100ml: 50 } }).table);

describe('weight-aware ingredient rows', () => {
    it('merges converted volumes with written weights', () => {
        const groups = buildIngredientDisplayGroups(
            recipe([ingredient('flour', 2, 'dl'), ingredient('flour', 50, 'g'), ingredient('salt', 1, 'tsp')]),
            settings,
            weights,
        );
        expect(groups[0]?.rows.map(row => [row.name, row.displayQty])).toEqual([
            ['flour', '150 g'],
            ['salt', '1 tsp'],
        ]);
    });

    it('leaves amounts untouched without a converter', () => {
        const groups = buildIngredientDisplayGroups(recipe([ingredient('flour', 2, 'dl')]), settings);
        expect(groups[0]?.rows[0]?.displayQty).toBe('2 dl');
    });

    it('never converts recipe references', () => {
        const reference = ingredient('flour', 2, 'dl', { reference: { name: 'flour', components: [] } } as Partial<Ingredient>);
        expect(ingredientQuantityDisplay(reference, weights)).toBe('2 dl');
        const groups = buildIngredientDisplayGroups(recipe([reference]), settings, weights);
        expect(groups[0]?.rows[0]?.reference).toEqual({ name: 'flour', components: [], quantity: 2, unit: 'dl' });
    });

    it('formats inline amounts in grams and leaves counts as written', () => {
        expect(ingredientQuantityDisplay(ingredient('flour', 3, 'dl'), weights)).toBe('150 g');
        expect(ingredientQuantityDisplay(ingredient('flour', 3, 'dl'), null)).toBe('3 dl');
        expect(ingredientQuantityDisplay(ingredient('egg', 3, null), weights)).toBe('3');
    });

    it('offers the toggle only when something other than a mass would change', () => {
        expect(recipeHasWeightConversions(recipe([ingredient('flour', 2, 'dl')]), weights)).toBe(true);
        expect(recipeHasWeightConversions(recipe([ingredient('sugar', 1, 'lb')]), weights)).toBe(false);
        expect(recipeHasWeightConversions(recipe([ingredient('salt', 1, 'tsp')]), weights)).toBe(false);
        expect(recipeHasWeightConversions(recipe([ingredient('flour', 2, 'dl')]), null)).toBe(false);
    });

    it('shows ranges as weight ranges when both ends convert', () => {
        expect(ingredientQuantityDisplay(rangeIngredient('flour', 2, 3, 'dl'), weights)).toBe('100–150 g');
        expect(ingredientQuantityDisplay(rangeIngredient('sugar', 1, 2, 'lb'), weights)).toBe('454–907 g');
        expect(ingredientQuantityDisplay(rangeIngredient('salt', 1, 2, 'tsp'), weights)).toBe('1-2 tsp');
        expect(ingredientQuantityDisplay(rangeIngredient('flour', 2, 3, 'dl'), null)).toBe('2-3 dl');
        const groups = buildIngredientDisplayGroups(
            recipe([rangeIngredient('flour', 2, 3, 'dl'), ingredient('flour', 50, 'g')]), settings, weights);
        expect(groups[0]?.rows[0]?.displayQty).toBe('50 g + 100–150 g');
        expect(recipeHasWeightConversions(recipe([rangeIngredient('flour', 2, 3, 'dl')]), weights)).toBe(true);
    });
});

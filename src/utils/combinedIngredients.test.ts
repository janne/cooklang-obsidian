import { describe, expect, it, vi } from 'vitest';
import { buildCombinedIngredients, sortRowsByName, type CombinedIngredientsDeps, type CombinedRecipe } from './combinedIngredients';

vi.mock('@cooklang/cooklang', () => ({
    ingredient_should_be_listed: () => true,
    ingredient_display_name: (ingredient: { name: string }) => ingredient.name,
    quantity_display: () => '',
}));

interface Item {
    name: string;
    qty?: number;
    unit?: string;
    ref?: string;
    optional?: boolean;
}

interface Doc {
    items: Item[];
    servings?: number | string;
    yield?: unknown;
}

/** Fake parser: numeric, scalable quantities multiply by the parse scale. */
function recipe(doc: Doc, scale: number): CombinedRecipe {
    return {
        servings: doc.servings,
        rawMetadata: new Map(doc.yield === undefined ? [] : [['yield', doc.yield]]),
        ingredients: doc.items.map(item => ({
            name: item.ref ? item.ref.split('/').pop()! : item.name,
            alias: null,
            note: null,
            relation: { type: 'definition', referencedFrom: [], definedInStep: true },
            modifiers: item.optional ? 'OPT' : '',
            reference: item.ref
                ? { name: item.ref.split('/').pop()!, components: ['.', ...item.ref.split('/').slice(0, -1)] }
                : null,
            quantity: item.qty === undefined ? null : {
                value: { type: 'number', value: { type: 'regular', value: item.qty * scale } },
                unit: item.unit ?? null,
                scalable: true,
            },
        })),
    } as unknown as CombinedRecipe;
}

function deps(files: Record<string, Doc>): CombinedIngredientsDeps & { reads: string[] } {
    const reads: string[] = [];
    return {
        reads,
        parse: (source, scale) => recipe(files[source], scale),
        read: async path => { reads.push(path); return path; },
        resolve: reference => {
            const path = [...reference.components.filter(part => part !== '.'), reference.name].join('/') + '.cook';
            return path in files ? path : null;
        },
    };
}

function quantities(rows: Array<{ name: string; displayQty: string | null }>): Record<string, string | null> {
    return Object.fromEntries(rows.map(row => [row.name, row.displayQty]));
}

describe('buildCombinedIngredients', () => {
    const risotto: Doc = { servings: 2, items: [{ name: 'rice', qty: 200, unit: 'g' }, { name: 'stock', qty: 1, unit: 'l' }] };

    it('doubles a recipe referenced with a bare number', async () => {
        const files = { menu: { items: [{ name: '', ref: 'Risotto', qty: 2 }] }, 'Risotto.cook': risotto };
        const list = await buildCombinedIngredients('Plan.menu', 'menu', 1, deps(files));
        expect(quantities(list.rows)).toEqual({ rice: '400 g', stock: '2 l' });
    });

    it('scales %servings against the referenced recipe servings', async () => {
        const files = { menu: { items: [{ name: '', ref: 'Risotto', qty: 6, unit: 'servings' }] }, 'Risotto.cook': risotto };
        const list = await buildCombinedIngredients('Plan.menu', 'menu', 1, deps(files));
        expect(quantities(list.rows)).toEqual({ rice: '600 g', stock: '3 l' });
    });

    it('uses the recipe as written for an empty reference and multiplies everything by the menu scale', async () => {
        const files = {
            menu: { items: [{ name: '', ref: 'Risotto' }, { name: 'rice', qty: 100, unit: 'g' }] },
            'Risotto.cook': risotto,
        };
        expect(quantities((await buildCombinedIngredients('Plan.menu', 'menu', 1, deps(files))).rows))
            .toEqual({ rice: '300 g', stock: '1 l' });
        expect(quantities((await buildCombinedIngredients('Plan.menu', 'menu', 2, deps(files))).rows))
            .toEqual({ rice: '600 g', stock: '2 l' });
    });

    it('multiplies factors through nested references and merges across recipes', async () => {
        const files = {
            menu: { items: [{ name: '', ref: 'Mains/Pizza', qty: 2 }, { name: '', ref: 'Risotto', qty: 1 }] },
            'Mains/Pizza.cook': { items: [{ name: 'cheese', qty: 100, unit: 'g' }, { name: '', ref: 'Dough', qty: 6, unit: 'balls' }] },
            'Dough.cook': { yield: '3%balls', items: [{ name: 'flour', qty: 300, unit: 'g' }] },
            'Risotto.cook': { servings: 2, items: [{ name: 'flour', qty: 50, unit: 'g' }] },
        };
        const visited: string[] = [];
        const list = await buildCombinedIngredients('Plan.menu', 'menu', 1,
            { ...deps(files), visit: path => { visited.push(path); } });
        // Pizza ×2, Dough ×2 (6 of 3 balls) within it: 300 g × 4 + 50 g of risotto flour.
        expect(quantities(list.rows)).toEqual({ cheese: '200 g', flour: '1.25 kg' });
        expect(list.dependencies).toEqual(['Mains/Pizza.cook', 'Dough.cook', 'Risotto.cook']);
        expect(visited).toEqual(list.dependencies);
    });

    it('matches one of several yields', async () => {
        const files = {
            menu: { items: [{ name: '', ref: 'Sauce', qty: 175, unit: 'g' }] },
            'Sauce.cook': { yield: ['500%ml', '350%g'], items: [{ name: 'butter', qty: 100, unit: 'g' }] },
        };
        const list = await buildCombinedIngredients('Plan.menu', 'menu', 1, deps(files));
        expect(quantities(list.rows)).toEqual({ butter: '50 g' });
    });

    it('reports missing recipes, unmatched yields, and cycles instead of guessing', async () => {
        const files = {
            menu: { items: [
                { name: '', ref: 'Nowhere', qty: 1 },
                { name: '', ref: 'Sauce', qty: 1, unit: 'cups' },
                { name: '', ref: 'Loop', qty: 1 },
            ] },
            'Sauce.cook': { yield: '500%ml', items: [{ name: 'butter', qty: 100, unit: 'g' }] },
            'Loop.cook': { items: [{ name: 'salt' }, { name: '', ref: 'Loop' }] },
        };
        const list = await buildCombinedIngredients('Plan.menu', 'menu', 1, deps(files));
        expect(list.problems).toEqual([
            { name: 'Nowhere', reason: 'recipe not found' },
            { name: 'Sauce', reason: 'the recipe has no yield in cups' },
            { name: 'Loop', reason: 'recipe references itself' },
        ]);
        expect(quantities(list.rows)).toEqual({ salt: null });
    });

    it('keeps optional items apart without expanding optional references', async () => {
        const files = {
            menu: { items: [{ name: 'chilli', qty: 1, optional: true }, { name: '', ref: 'Risotto', optional: true }] },
            'Risotto.cook': risotto,
        };
        const d = deps(files);
        const list = await buildCombinedIngredients('Plan.menu', 'menu', 1, d);
        expect(list.rows).toEqual([]);
        expect(list.optional.map(row => row.name)).toEqual(['chilli', 'Risotto']);
        expect(d.reads).toEqual([]);
    });

    it('sorts combined and optional rows alphabetically', async () => {
        const files = {
            menu: { items: [
                { name: 'salt' }, { name: 'Apples', qty: 2 }, { name: 'zest', optional: true },
                { name: 'basil', optional: true }, { name: '', ref: 'Risotto' },
            ] },
            'Risotto.cook': risotto,
        };
        const list = await buildCombinedIngredients('Plan.menu', 'menu', 1, deps(files));
        expect(list.rows.map(row => row.name)).toEqual(['Apples', 'rice', 'salt', 'stock']);
        expect(list.optional.map(row => row.name)).toEqual(['basil', 'zest']);
    });

    it('sorts in the locale, ignoring case and comparing numbers by value', () => {
        const row = (name: string) => ({ name, displayQty: null, preparations: [], reference: null });
        const names = (list: string[], locale: string) => sortRowsByName(list.map(row), locale).map(entry => entry.name);
        expect(names(['äpple', 'Zucchini', 'apelsin', 'ört'], 'sv')).toEqual(['apelsin', 'Zucchini', 'äpple', 'ört']);
        expect(names(['egg 10', 'egg 9'], 'en')).toEqual(['egg 9', 'egg 10']);
    });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type { CooklangRecipe } from '@cooklang/cooklang';
import MenuPreview from './MenuPreview.svelte';
import type { CombinedIngredientsState, RecipeHostAdapter, RecipeRenderModel } from './types';
import type { CooklangSettings } from '../settings';

vi.mock('@cooklang/cooklang', () => ({
    ingredient_should_be_listed: () => true,
    ingredient_display_name: (ingredient: { name: string }) => ingredient.name,
    cookware_display_name: (cookware: { name: string }) => cookware.name,
    quantity_display: (quantity: { display?: string }) => quantity.display ?? '',
}));

afterEach(() => {
    cleanup();
    document.body.replaceChildren();
});

const number = (value: number, unit: string | null, display: string) =>
    ({ value: { type: 'number', value: { type: 'regular', value } }, unit, display });

/** Parser output for a two-day plan, as observed from the WASM parser. */
function menuRecipe(): CooklangRecipe {
    return {
        title: undefined,
        servings: 2,
        tags: new Set(),
        ingredients: [
            { name: 'Granola', note: null, reference: { name: 'Granola', components: ['.', 'Breakfast'] }, quantity: number(4, 'servings', '4 servings') },
            { name: 'yogurt', note: null, reference: null, quantity: number(200, 'g', '200 g') },
            { name: 'Risotto', note: null, reference: { name: 'Risotto', components: ['.'] }, quantity: null },
        ],
        cookware: [],
        timers: [],
        inlineQuantities: [],
        sections: [
            { name: 'Monday (2026-10-21)', content: [
                { type: 'step', value: { number: 1, items: [
                    { type: 'text', value: 'Breakfast: \n- ' }, { type: 'ingredient', index: 0 },
                    { type: 'text', value: ' with ' }, { type: 'ingredient', index: 1 },
                ] } },
                { type: 'text', value: 'delivery at 4pm' },
            ] },
            { name: 'Tuesday (2026-10-22)', content: [
                { type: 'step', value: { number: 1, items: [
                    { type: 'text', value: 'Dinner: \n- ' }, { type: 'ingredient', index: 2 },
                ] } },
            ] },
        ],
        rawMetadata: new Map([['servings', '2']]),
    } as unknown as CooklangRecipe;
}

function setup(combined: CombinedIngredientsState, scale = 1, images: Record<string, string> = {}, showImages = true) {
    const openReference = vi.fn();
    const onIngredientToggle = vi.fn();
    const host: RecipeHostAdapter = {
        getResourcePath: file => file.path,
        resolveReference: (_file, reference) => ({
            targetPath: `${reference.name}.cook`, sourcePath: 'Plan.menu',
            scaleRequest: reference.quantity === null ? null : { quantity: reference.quantity, unit: reference.unit },
        }),
        openReference,
        openWikiLink: vi.fn(),
    };
    const model: RecipeRenderModel = {
        instanceId: 'test-menu',
        interactive: true,
        recipe: menuRecipe(),
        file: null,
        settings: { showImages, showServingsScaler: true, twoColumnLayout: true, highlightIngredientCookware: true,
            ingredientLabel: '', servingsLabel: '', metadataLabel: '', minutesLabel: '', hoursLabel: '', secondsLabel: '' } as CooklangSettings,
        state: { scale, baseServings: 2, displayServings: 2 * scale, checkedIngredients: new Set(), currentStep: -1 },
        callbacks: { onScaleChange: vi.fn(), onIngredientToggle, onStepActivate: vi.fn() },
        host,
        timers: null,
    };
    // CookViewRoot provides the `.cook-rich` scope the bar's section links search.
    const target = document.body.appendChild(document.createElement('div'));
    target.className = 'cook-rich';
    render(MenuPreview, { target, props: { model, menu: { today: '2026-10-21', combined, images } } });
    return { openReference, onIngredientToggle };
}

describe('MenuPreview', () => {
    it('renders days and meals, marks today, and opens scaled references', async () => {
        const { openReference } = setup({ status: 'loading' }, 2);

        const today = screen.getByRole('article', { current: 'date' });
        expect(within(today).getByRole('heading', { name: 'Monday' })).toBeTruthy();
        expect(within(today).getByText('Today')).toBeTruthy();
        expect(within(today).getByRole('heading', { name: 'Breakfast' })).toBeTruthy();
        expect(within(today).getByText('delivery at 4pm')).toBeTruthy();
        expect(screen.getByText('2026-10-22')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Today' })).toBeTruthy();
        expect(screen.getByText('Combining ingredients…')).toBeTruthy();

        await fireEvent.click(screen.getByRole('link', { name: 'Granola' }));
        expect(openReference).toHaveBeenLastCalledWith(expect.objectContaining({ scaleRequest: { quantity: 4, unit: 'servings' } }));
        // `{}` has no quantity of its own, so the plan scale is the multiplier.
        expect(screen.getByText('×2')).toBeTruthy();
        await fireEvent.click(screen.getByRole('link', { name: 'Risotto' }));
        expect(openReference).toHaveBeenLastCalledWith(expect.objectContaining({ scaleRequest: { quantity: 2, unit: null } }));
    });

    it('lists combined and optional ingredients with problems', async () => {
        const { onIngredientToggle } = setup({ status: 'ready', list: {
            rows: [{ name: 'rice', displayQty: '600 g', preparations: [], reference: null }],
            optional: [{ name: 'chilli', displayQty: '1', preparations: [], reference: null }],
            problems: [{ name: 'Salads/Boring', reason: 'recipe not found' }],
            dependencies: [],
        } });

        const combined = screen.getByRole('heading', { name: 'Combined ingredients' }).closest('section')!;
        expect(within(combined).getByText('600 g')).toBeTruthy();
        expect(within(combined).getByRole('heading', { name: 'Optional' })).toBeTruthy();
        expect(screen.getByText('Salads/Boring')).toBeTruthy();
        expect(screen.getByText(/recipe not found/)).toBeTruthy();

        await fireEvent.click(within(combined).getByRole('checkbox', { name: 'Check rice' }));
        expect(onIngredientToggle).toHaveBeenCalledWith('rice');
    });

    it('puts the plan before the ingredients', () => {
        setup({ status: 'loading' });
        const plan = screen.getByRole('heading', { name: 'Plan' });
        const combined = screen.getByRole('heading', { name: 'Combined ingredients' });
        expect(plan.compareDocumentPosition(combined) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows each referenced recipe\'s image above it when images are enabled', () => {
        setup({ status: 'loading' }, 1, { 'Granola.cook': 'https://example.com/granola.jpg' });
        const image = screen.getByRole('img', { name: 'Granola' }) as HTMLImageElement;
        expect(image.src).toBe('https://example.com/granola.jpg');
        expect(image.getAttribute('loading')).toBe('lazy');
        const item = image.closest('li')!;
        expect(image.compareDocumentPosition(within(item).getByRole('link', { name: 'Granola' }))
            & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('img', { name: 'Risotto' })).toBeNull();
        cleanup();
        document.body.replaceChildren();

        setup({ status: 'loading' }, 1, { 'Granola.cook': 'https://example.com/granola.jpg' }, false);
        expect(screen.queryByRole('img')).toBeNull();
    });
});

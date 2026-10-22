<script lang="ts">
    import { ingredient_display_name, quantity_display } from '../../recipeHelpers';
    import { menuReferenceAmount, menuReferenceTarget } from '../../utils/menuModel';
    import { numericFromQuantity } from '../../utils/quantityValue';
    import type { StepPart as StepPartModel } from '../../utils/sectionHelpers';
    import ReferenceLink from './ReferenceLink.svelte';
    import StepPart from './StepPart.svelte';
    import type { RecipeRenderModel } from '../types';

    let {
        model,
        part,
        unitMap,
        timerKey,
    }: {
        model: RecipeRenderModel;
        part: StepPartModel;
        unitMap: Record<string, number>;
        timerKey: string;
    } = $props();

    let reference = $derived.by(() => {
        if (part.type !== 'ingredient' || !part.ingredient.reference) return null;
        const quantity = part.ingredient.quantity;
        const value = quantity ? numericFromQuantity(quantity) : null;
        return menuReferenceTarget(part.ingredient.reference,
            value === null ? null : { value, unit: quantity?.unit ?? null }, model.state.scale);
    });
    let referenceAmount = $derived(reference ? menuReferenceAmount(reference) : null);
</script>

{#if part.type === 'ingredient' && reference}
    <span class="cook-menu-ref">
        <ReferenceLink {model} {reference} />{#if referenceAmount}{' '}<span class="cook-amt">{referenceAmount}</span>{/if}
    </span>
{:else if part.type === 'ingredient'}
    <span class:cook-ig-hl={model.settings.highlightIngredientCookware} class="cook-ig">
        {ingredient_display_name(part.ingredient)}{#if part.ingredient.note?.trim()}<span class="cook-ig-prep">, {part.ingredient.note.trim()}</span>{/if}{#if part.ingredient.quantity}
            {' '}<span class="cook-amt">({quantity_display(part.ingredient.quantity)})</span>
        {/if}
    </span>
{:else}
    <StepPart {model} {part} {unitMap} {timerKey} />
{/if}

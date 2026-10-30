<script lang="ts">
    import type { IngredientRow } from '../../utils/ingredientAggregator';
    import { buildIngredientDisplayGroups, weightConvertibleNames } from '../../utils/ingredientRows';
    import { showsWeight, weightsFor, type RecipeRenderModel } from '../types';
    import ReferenceLink from './ReferenceLink.svelte';

    let { model }: { model: RecipeRenderModel } = $props();
    let groups = $derived(buildIngredientDisplayGroups(model.recipe, model.settings, weightsFor(model)));
    let convertible = $derived(model.interactive ? weightConvertibleNames(model.recipe, model.weights) : new Set<string>());

    function toggleMeasure(event: MouseEvent, name: string): void {
        // Inside a <summary>, the click would also open or close the preparations.
        event.preventDefault();
        event.stopPropagation();
        model.callbacks.onIngredientMeasureToggle(name);
    }
</script>

{#snippet quantity(row: IngredientRow)}
    {#if row.displayQty && convertible.has(row.name)}
        {@const target = showsWeight(model, row.name) ? 'volume' : 'weight'}
        <button
            type="button"
            class="cook-ing-qty cook-ing-qty-toggle"
            aria-label={`${row.displayQty}. Show ${row.name} by ${target}`}
            onclick={event => toggleMeasure(event, row.name)}
        >
            <svg class="cook-ing-qty-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3 4 7l4 4" /><path d="M4 7h16" /><path d="m16 21 4-4-4-4" /><path d="M20 17H4" />
            </svg>
            <span>{row.displayQty}</span>
        </button>
    {:else if row.displayQty}
        <span class="cook-ing-qty">{row.displayQty}</span>
    {/if}
{/snippet}

{#if groups.length}
    <section class="cook-ingredients" id="cook-ingredients">
        <h2 class="cook-section-title">{model.settings.ingredientLabel || 'Ingredients'}</h2>
        {#each groups as group, groupIndex}
            {#if group.name}
                <h3 class="cook-ing-group-title">{group.name}</h3>
            {/if}
            <ul class="cook-ing-list">
                {#each group.rows as row, rowIndex}
                    {@const inputId = `${model.instanceId}-ingredient-${groupIndex}-${rowIndex}`}
                    {@const checked = model.state.checkedIngredients.has(row.name)}
                    {@const singlePreparation = row.preparations.length === 1 ? row.preparations[0] : null}
                    <li class:done={checked} class="cook-ing">
                        {#if model.interactive}
                            <label class="cook-ing-checkbox-hit">
                                <input
                                    id={inputId}
                                    class="cook-ing-checkbox"
                                    type="checkbox"
                                    {checked}
                                    aria-label={`${checked ? 'Uncheck' : 'Check'} ${row.name}`}
                                    onchange={() => model.callbacks.onIngredientToggle(row.name)}
                                />
                            </label>
                        {:else}
                            <span class="cook-ing-checkbox" aria-hidden="true"></span>
                        {/if}
                        <div class="cook-ing-content">
                            {#if row.preparations.length > 1}
                                <details class="cook-ing-details">
                                    <summary class="cook-ing-main">
                                        <span class="cook-ing-name">
                                            {#if row.reference}
                                                <ReferenceLink {model} reference={row.reference} />
                                            {:else}
                                                {row.name}
                                            {/if}
                                        </span>
                                        {@render quantity(row)}
                                        <span class="cook-ing-disclosure-icon" aria-hidden="true"></span>
                                    </summary>
                                    <ul class="cook-ing-prep-list">
                                        {#each row.preparations as preparation}
                                            <li class="cook-ing-prep">
                                                <span class="cook-ing-prep-name">{preparation.name}</span>
                                                {#if preparation.displayQty}
                                                    <span class="cook-ing-prep-qty">{preparation.displayQty}</span>
                                                {/if}
                                            </li>
                                        {/each}
                                    </ul>
                                </details>
                            {:else}
                                <div class="cook-ing-main">
                                    <span class="cook-ing-name">
                                        {#if row.reference}
                                            <ReferenceLink {model} reference={row.reference} />
                                        {:else}
                                            {row.name}
                                        {/if}
                                        {#if singlePreparation}
                                            <span class="cook-ing-single-prep">
                                                — {singlePreparation.name}
                                            </span>
                                        {/if}
                                    </span>
                                    {@render quantity(row)}
                                </div>
                            {/if}
                        </div>
                    </li>
                {/each}
            </ul>
        {/each}
    </section>
{/if}

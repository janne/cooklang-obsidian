<script lang="ts">
    import { findRecipeImages } from '../utils/imageHelpers';
    import type { IngredientDisplayGroup } from '../utils/ingredientRows';
    import { buildMenuDays } from '../utils/menuModel';
    import { getRecipeImageUrls } from '../utils/recipeImages';
    import { getSections } from '../utils/sectionHelpers';
    import Hero from './components/Hero.svelte';
    import IngredientList from './components/IngredientList.svelte';
    import Metadata from './components/Metadata.svelte';
    import ScalerBar from './components/ScalerBar.svelte';
    import type { MenuRenderState, RecipeRenderModel } from './types';
    import MenuDays from './components/MenuDays.svelte';

    let { model, menu }: { model: RecipeRenderModel; menu: MenuRenderState } = $props();
    let images = $derived(findRecipeImages(model.file));
    let mainImage = $derived(images.mainImage ?? getRecipeImageUrls(model.recipe.images)[0] ?? null);
    let days = $derived(buildMenuDays(getSections(model.recipe), menu.today));
    let combined = $derived(menu.combined);
    let groups = $derived.by((): IngredientDisplayGroup[] => {
        if (combined.status !== 'ready') return [];
        const result: IngredientDisplayGroup[] = [];
        if (combined.list.rows.length) result.push({ name: null, rows: combined.list.rows });
        if (combined.list.optional.length) result.push({ name: 'Optional', rows: combined.list.optional });
        return result;
    });
    let rowCount = $derived(combined.status === 'ready'
        ? combined.list.rows.length + combined.list.optional.length : null);
    let links = $derived([
        { selector: '#cook-combined', label: model.settings.ingredientLabel || 'Ingredients' },
        { selector: '#cook-menu-plan', label: 'Plan' },
        ...(days.some(day => day.isToday) ? [{ selector: '#cook-menu-today', label: 'Today' }] : []),
    ]);
</script>

<Hero {model} {mainImage} />
<ScalerBar {model} {links} />

<!-- The plan comes first: beside the ingredients on wide panes, above them when stacked. -->
<div class:cook-cols-stacked={!model.settings.twoColumnLayout} class="cook-cols cook-menu-cols">
    <main class="cook-main">
        <MenuDays {model} {days} />
    </main>
    <aside class="cook-aside" aria-label="Combined ingredients">
        <details class="cook-menu-combined" id="cook-combined" open>
            <summary class="cook-menu-combined-summary">
                <h2 class="cook-section-title">Combined ingredients</h2>
                {#if rowCount !== null}
                    <span class="cook-menu-combined-count">{rowCount}</span>
                {/if}
                <span class="cook-ing-disclosure-icon" aria-hidden="true"></span>
            </summary>
            <IngredientList {model} {groups} heading={false} sectionId="cook-combined-list">
                {#snippet empty()}
                    <p class="cook-menu-status">
                        {#if combined.status === 'loading'}
                            Combining ingredients…
                        {:else if combined.status === 'error'}
                            Could not combine ingredients: {combined.message}
                        {:else}
                            No ingredients yet.
                        {/if}
                    </p>
                {/snippet}
            </IngredientList>
            {#if combined.status === 'ready' && combined.list.problems.length}
                <div class="cook-menu-problems">
                    <h3 class="cook-ing-group-title">Not included</h3>
                    <ul class="cook-menu-problem-list">
                        {#each combined.list.problems as problem}
                            <li><span class="cook-menu-problem-name">{problem.name}</span>: {problem.reason}</li>
                        {/each}
                    </ul>
                </div>
            {/if}
        </details>
    </aside>
</div>

<Metadata {model} />

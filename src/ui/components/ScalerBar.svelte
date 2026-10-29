<script lang="ts">
    import { recipeHasWeightConversions } from '../../utils/ingredientRows';
    import { clampServings } from '../../utils/scaling';
    import type { MeasureMode } from '../../utils/weightConversion';
    import type { RecipeRenderModel } from '../types';

    let { model }: { model: RecipeRenderModel } = $props();
    let showScaler = $derived(
        model.settings.showServingsScaler
        && model.state.baseServings !== null
        && model.state.displayServings !== null,
    );
    let showMeasure = $derived(model.interactive && recipeHasWeightConversions(model.recipe, model.weights));
    const measures: Array<{ value: MeasureMode; label: string }> = [
        { value: 'volume', label: 'Volume' },
        { value: 'weight', label: 'Weight' },
    ];

    function scrollTo(event: MouseEvent, selector: string): void {
        event.preventDefault();
        const current = event.currentTarget as HTMLElement;
        current.closest('.cook-rich')
            ?.querySelector(selector)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
</script>

<nav class="cook-bar" aria-label="Recipe sections and servings">
    <div class="cook-bar-nav">
        <a class="cook-bar-link" href="#cook-ingredients" onclick={(event) => scrollTo(event, '#cook-ingredients')}>
            {model.settings.ingredientLabel || 'Ingredients'}
        </a>
        <a class="cook-bar-link" href="#cook-steps" onclick={(event) => scrollTo(event, '#cook-steps')}>
            {model.settings.methodLabel || 'Steps'}
        </a>
    </div>

    {#if showMeasure}
        <div class="cook-measure" role="group" aria-label="Ingredient amounts">
            {#each measures as measure}
                <button
                    type="button"
                    class="cook-measure-btn"
                    aria-pressed={model.state.measure === measure.value}
                    onclick={() => model.callbacks.onMeasureChange(measure.value)}
                >{measure.label}</button>
            {/each}
        </div>
    {/if}

    {#if showScaler && model.state.displayServings !== null}
        <div class="cook-stepper">
            <button
                type="button"
                class="cook-stepper-btn"
                aria-label="Fewer servings"
                disabled={model.state.displayServings <= 1}
                onclick={() => model.callbacks.onScaleChange(clampServings(model.state.displayServings! - 1))}
            >−</button>
            <span class="cook-stepper-val" aria-live="polite">
                <b>{model.state.displayServings}</b> {model.settings.servingsLabel || 'servings'}
            </span>
            <button
                type="button"
                class="cook-stepper-btn"
                aria-label="More servings"
                disabled={model.state.displayServings >= 1000}
                onclick={() => model.callbacks.onScaleChange(clampServings(model.state.displayServings! + 1))}
            >+</button>
        </div>
    {/if}
</nav>

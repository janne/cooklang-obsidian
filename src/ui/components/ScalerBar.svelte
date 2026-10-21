<script lang="ts">
    import { clampServings } from '../../utils/scaling';
    import type { RecipeRenderModel } from '../types';

    interface BarLink { selector: string; label: string; }

    let { model, links }: { model: RecipeRenderModel; links?: BarLink[] } = $props();
    let navLinks = $derived(links ?? [
        { selector: '#cook-ingredients', label: model.settings.ingredientLabel || 'Ingredients' },
        { selector: '#cook-steps', label: model.settings.methodLabel || 'Steps' },
    ]);
    let showScaler = $derived(
        model.settings.showServingsScaler
        && model.state.baseServings !== null
        && model.state.displayServings !== null,
    );

    function scrollTo(event: MouseEvent, selector: string): void {
        event.preventDefault();
        const current = event.currentTarget as HTMLElement;
        const target = current.closest('.cook-rich')?.querySelector(selector);
        // A collapsed section (e.g. a menu's combined ingredients) opens when jumped to.
        // Compare tag names: `instanceof` fails for elements in Obsidian pop-out windows.
        if (target?.tagName === 'DETAILS') (target as HTMLDetailsElement).open = true;
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
</script>

<nav class="cook-bar" aria-label="Recipe sections and servings">
    <div class="cook-bar-nav">
        {#each navLinks as link}
            <a class="cook-bar-link" href={link.selector} onclick={(event) => scrollTo(event, link.selector)}>
                {link.label}
            </a>
        {/each}
    </div>

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

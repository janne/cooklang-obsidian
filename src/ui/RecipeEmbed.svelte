<script lang="ts">
    import type { Readable } from 'svelte/store';
    import Hero from './components/Hero.svelte';
    import IngredientList from './components/IngredientList.svelte';
    import { findRecipeImages } from '../utils/imageHelpers';
    import { getRecipeImageUrls } from '../utils/recipeImages';
    import MethodSteps from './components/MethodSteps.svelte';
    import type { EmbedRenderState } from './types';
    import { recipeName } from '../utils/recipeFiles';

    let {
        renderState,
        wholeNote = false,
        header = false,
    }: {
        renderState: Readable<EmbedRenderState>;
        wholeNote?: boolean;
        /** The full preview's header instead of a title link, for hover previews. */
        header?: boolean;
    } = $props();
    let mainImage = $derived.by(() => {
        if (!header || $renderState.status !== 'ready') return null;
        const model = $renderState.model;
        return findRecipeImages(model.file).mainImage ?? getRecipeImageUrls(model.recipe.images)[0] ?? null;
    });
</script>

{#if $renderState.status === 'loading'}
    <div class="cook-embed-loading" role="status">Loading recipe…</div>
{:else if $renderState.status === 'empty'}
    <div class="cook-embed-empty">{wholeNote ? 'Empty recipe.' : 'Empty recipe block.'}</div>
{:else if $renderState.status === 'error'}
    <div class="cook-embed-error" role="alert">
        <div class="cook-embed-error-msg">{$renderState.message}</div>
        <pre><code>{$renderState.source}</code></pre>
    </div>
{:else}
    <div class="cook-embed">
        {#if header}
            <Hero model={$renderState.model} {mainImage} />
        {:else if wholeNote && $renderState.model.file}
            {@const model = $renderState.model}
            {@const file = model.file!}
            <h2 class="cook-embed-title"><a href={file.path} onclick={event => {
                event.preventDefault();
                event.stopPropagation();
                model.host.openReference({ targetPath: file.path, sourcePath: file.path, scaleRequest: null });
            }}>{model.recipe.title?.trim() || recipeName(file.path)}</a></h2>
        {/if}
        <IngredientList model={$renderState.model} />
        <MethodSteps model={$renderState.model} allImages={[]} />
    </div>
{/if}

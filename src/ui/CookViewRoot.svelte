<script lang="ts">
    import MenuPreview from './MenuPreview.svelte';
    import RecipePreview from './RecipePreview.svelte';
    import type { CookViewRootProps } from './types';

    let { preview }: CookViewRootProps = $props();
</script>

<div
    class="cook-preview-view"
    class:cook-rich={$preview !== null}
>
    {#if $preview?.menu}
        <MenuPreview model={$preview} menu={$preview.menu} />
    {:else if $preview}
        <RecipePreview model={$preview} />
    {/if}
</div>

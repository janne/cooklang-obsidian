<script lang="ts">
    import type { MenuDay } from '../../utils/menuModel';
    import {
        createUnitMap,
        DEFAULT_HOURS_LABELS,
        DEFAULT_MINUTES_LABELS,
        DEFAULT_SECONDS_LABELS,
    } from '../../utils/timeFormatters';
    import InlineText from './InlineText.svelte';
    import type { RecipeRenderModel } from '../types';
    import MenuPart from './MenuPart.svelte';

    import type { StepPart } from '../../utils/sectionHelpers';
    import { menuReferenceTarget } from '../../utils/menuModel';
    import { numericFromQuantity } from '../../utils/quantityValue';
    import type { ResolvedRecipeReference } from '../types';

    let { model, days, images = {} }: { model: RecipeRenderModel; days: MenuDay[]; images?: Record<string, string> } = $props();

    /** Main images of the recipes referenced on a line, opening them like their links. */
    function lineImages(line: StepPart[]): { url: string; resolved: ResolvedRecipeReference }[] {
        if (!model.settings.showImages) return [];
        return line.flatMap(part => {
            if (part.type !== 'ingredient' || !part.ingredient.reference) return [];
            const quantity = part.ingredient.quantity;
            const value = quantity ? numericFromQuantity(quantity) : null;
            const target = menuReferenceTarget(part.ingredient.reference,
                value === null ? null : { value, unit: quantity?.unit ?? null }, model.state.scale);
            const resolved = model.host.resolveReference(model.file, target);
            const url = resolved ? images[resolved.targetPath] : undefined;
            return resolved && url ? [{ url, resolved }] : [];
        });
    }

    function open(event: MouseEvent, resolved: ResolvedRecipeReference): void {
        event.preventDefault();
        event.stopPropagation();
        model.host.openReference(resolved);
    }
    let unitMap = $derived(createUnitMap(
        model.settings.minutesLabel || DEFAULT_MINUTES_LABELS,
        model.settings.hoursLabel || DEFAULT_HOURS_LABELS,
        model.settings.secondsLabel || DEFAULT_SECONDS_LABELS,
    ));
</script>

<section class="cook-menu-plan" id="cook-menu-plan">
    <h2 class="cook-section-title">Plan</h2>
    {#each days as day, dayIndex}
        <article
            class:cook-menu-today={day.isToday}
            class="cook-menu-day"
            id={day.isToday ? 'cook-menu-today' : undefined}
            aria-current={day.isToday ? 'date' : undefined}
        >
            {#if day.title || day.date}
                <header class="cook-menu-day-head">
                    <h3 class="cook-menu-day-title">{day.title ?? day.date}</h3>
                    {#if day.isToday}
                        <span class="cook-menu-today-badge">Today</span>
                    {:else if day.date && day.title}
                        <time class="cook-menu-day-date" datetime={day.date}>{day.date}</time>
                    {/if}
                </header>
            {/if}
            {#each day.entries as entry, entryIndex}
                {#if entry.type === 'note'}
                    <aside class="cook-note">
                        <span class="cook-note-icon" aria-hidden="true">💡</span>
                        <span class="cook-note-text"><InlineText {model} value={entry.note} /></span>
                    </aside>
                {:else}
                    <div class="cook-menu-meal">
                        {#if entry.label}
                            <h4 class="cook-menu-meal-label">{entry.label}</h4>
                        {/if}
                        <ul class="cook-menu-items">
                            {#each entry.lines as line, lineIndex}
                                {@const pictures = lineImages(line)}
                                <li class:cook-menu-item-pictured={pictures.length > 0} class="cook-menu-item">
                                    {#if pictures.length}
                                        <div class="cook-menu-item-images">
                                            <!-- The recipe's text link below carries its name and keyboard focus. -->
                                            {#each pictures as picture}
                                                <a
                                                    class="cook-menu-item-image-link"
                                                    href={picture.resolved.targetPath}
                                                    tabindex="-1"
                                                    aria-hidden="true"
                                                    onclick={event => open(event, picture.resolved)}
                                                >
                                                    <img
                                                        class="cook-menu-item-image"
                                                        src={picture.url}
                                                        alt=""
                                                        loading="lazy"
                                                        decoding="async"
                                                    />
                                                </a>
                                            {/each}
                                        </div>
                                    {/if}
                                    {#each line as part, partIndex}
                                        <MenuPart
                                            {model}
                                            {part}
                                            {unitMap}
                                            timerKey={`${model.instanceId}:menu-${dayIndex}-${entryIndex}-${lineIndex}-${partIndex}`}
                                        />
                                    {/each}
                                </li>
                            {/each}
                        </ul>
                    </div>
                {/if}
            {/each}
        </article>
    {/each}
</section>

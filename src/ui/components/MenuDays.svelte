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

    let { model, days }: { model: RecipeRenderModel; days: MenuDay[] } = $props();
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
                                <li class="cook-menu-item">
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

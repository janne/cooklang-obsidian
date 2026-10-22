import { describe, expect, it } from 'vitest';
import type { Ingredient } from '@cooklang/cooklang';
import { buildMenuDays, localDateKey, menuReferenceAmount, menuReferenceTarget, parseDayName, splitMealLines } from './menuModel';
import type { SectionView, StepPart } from './sectionHelpers';

const ingredient = (name: string): StepPart => ({ type: 'ingredient', ingredient: { name } as Ingredient });
const text = (value: string): StepPart => ({ type: 'text', value });

function section(name: string | null, ...steps: StepPart[][]): SectionView {
    return {
        name,
        ingredientIndices: [],
        entries: steps.map((parts, index) => ({ type: 'step', step: { number: index + 1, globalIndex: index, parts } })),
    };
}

describe('menu model', () => {
    it('reads an ISO date from a day name', () => {
        expect(parseDayName('Saturday (2026-03-07)')).toEqual({ title: 'Saturday', date: '2026-03-07' });
        expect(parseDayName('Day 1')).toEqual({ title: 'Day 1', date: null });
        expect(parseDayName('(2026-03-07)')).toEqual({ title: null, date: '2026-03-07' });
        expect(parseDayName(null)).toEqual({ title: null, date: null });
    });

    it('formats the local date', () => {
        expect(localDateKey(new Date(2026, 2, 7, 23, 30))).toBe('2026-03-07');
    });

    it('splits joined lines and removes list bullets', () => {
        // Parser output for `Breakfast: \` / `- @granola with @yogurt \` / `- @coffee`.
        const lines = splitMealLines([
            text('Breakfast: \n- '), ingredient('granola'), text(' with '), ingredient('yogurt'),
            text(' \n- '), ingredient('coffee'),
        ]);
        expect(lines).toEqual([
            [text('Breakfast:')],
            [ingredient('granola'), text(' with '), ingredient('yogurt')],
            [ingredient('coffee')],
        ]);
    });

    it('restores lists whose lines Cooklang joined without backslashes', () => {
        // Parser output for three `- @./…{}` lines without trailing `\`.
        expect(splitMealLines([
            text('- '), ingredient('Orange chicken'), text(' - '), ingredient('Schnitzel'), text(' - '), ingredient('Tacos'),
        ])).toEqual([[ingredient('Orange chicken')], [ingredient('Schnitzel')], [ingredient('Tacos')]]);
        expect(splitMealLines([text('Lunch: - '), ingredient('soup'), text(' - '), ingredient('bread')]))
            .toEqual([[text('Lunch:')], [ingredient('soup')], [ingredient('bread')]]);
    });

    it('requires bullets for a list: items with only spaces between them stay on one line', () => {
        expect(splitMealLines([ingredient('Orange chicken'), text(' '), ingredient('Tacos')]))
            .toEqual([[ingredient('Orange chicken'), text(' '), ingredient('Tacos')]]);
    });

    it('keeps spaced dashes in meals that do not start as a list', () => {
        expect(splitMealLines([ingredient('pasta'), text(' - gärna färsk')]))
            .toEqual([[ingredient('pasta'), text(' - gärna färsk')]]);
    });

    it('builds days with meal labels, notes and today', () => {
        const day = section('Day 1 (2026-10-21)',
            [text('Lunch: \n- '), ingredient('soup')],
            [ingredient('apples'), text(' and '), ingredient('kefir')]);
        day.entries.push({ type: 'note', note: 'delivery at 4pm' });
        const days = buildMenuDays([section(null), day, section('Snacks', [text('- '), ingredient('dates')])], '2026-10-21');

        expect(days).toHaveLength(2);
        expect(days[0]).toMatchObject({ title: 'Day 1', date: '2026-10-21', isToday: true });
        expect(days[0].entries).toEqual([
            { type: 'meal', label: 'Lunch', lines: [[ingredient('soup')]] },
            { type: 'meal', label: null, lines: [[ingredient('apples'), text(' and '), ingredient('kefir')]] },
            { type: 'note', note: 'delivery at 4pm' },
        ]);
        expect(days[1]).toMatchObject({ title: 'Snacks', date: null, isToday: false });
    });

    it('opens references at the plan scale, including empty references', () => {
        const risotto = { name: 'Risotto', components: ['.', 'Mains'] };
        const doubled = menuReferenceTarget(risotto, { value: 4, unit: null }, 2);
        expect(doubled).toEqual({ name: 'Risotto', components: ['.', 'Mains'], quantity: 4, unit: null });
        expect(menuReferenceAmount(doubled)).toBe('×4');
        expect(menuReferenceAmount(menuReferenceTarget(risotto, { value: 6, unit: 'servings' }, 1))).toBe('6 servings');
        expect(menuReferenceTarget(risotto, null, 1).quantity).toBeNull();
        expect(menuReferenceAmount(menuReferenceTarget(risotto, null, 1))).toBeNull();
        expect(menuReferenceTarget(risotto, null, 1.5)).toMatchObject({ quantity: 1.5, unit: null });
    });

});

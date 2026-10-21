import { describe, expect, it } from 'vitest';
import { findSourceReferences, referenceAt } from './sourceReferences';

describe('source references', () => {
    it('finds complete references with their amounts', () => {
        const line = '- @./Recept/Litauiska pannkakor{} med @lingonsylt{1%dl} och @?./Recept/Pizzasallad{1/2}';
        expect(findSourceReferences(line)).toEqual([
            { from: 2, to: 33, pathFrom: 3, pathTo: 31,
                target: { name: 'Litauiska pannkakor', components: ['.', 'Recept'], quantity: null, unit: null } },
            { from: 60, to: 87, pathFrom: 62, pathTo: 82,
                target: { name: 'Pizzasallad', components: ['.', 'Recept'], quantity: 0.5, unit: null } },
        ]);
    });

    it('parses servings, yields, multipliers and fixed amounts', () => {
        const amount = (braces: string) => findSourceReferences(`@./Risotto{${braces}}`)[0].target;
        expect(amount('6%servings')).toMatchObject({ quantity: 6, unit: 'servings' });
        expect(amount('150 % ml')).toMatchObject({ quantity: 150, unit: 'ml' });
        expect(amount('2')).toMatchObject({ quantity: 2, unit: null });
        expect(amount('=1.5')).toMatchObject({ quantity: 1.5, unit: null });
        expect(amount('a lot')).toMatchObject({ quantity: null, unit: null });
    });

    it('keeps names with dots, ampersands and parentheses', () => {
        expect(findSourceReferences('@./Recept/Mac & Cheese.cook{}')[0].target)
            .toMatchObject({ name: 'Mac & Cheese.cook', components: ['.', 'Recept'] });
        expect(findSourceReferences('@./Recept/Litauiska zeppelinare (Cepelinai){}')[0].target.name)
            .toBe('Litauiska zeppelinare (Cepelinai)');
    });

    it('ignores incomplete references and plain ingredients', () => {
        expect(findSourceReferences('@./Recept/Pizzasallad and @salt{1%tsp}')).toEqual([]);
    });

    it('finds the reference under the cursor, including its edges', () => {
        const line = 'Lunch: @./Soup{} and @./Bread{2}';
        expect(referenceAt(line, 7)?.target.name).toBe('Soup');
        expect(referenceAt(line, 16)?.target.name).toBe('Soup');
        expect(referenceAt(line, 18)).toBeNull();
        expect(referenceAt(line, 25)?.target.name).toBe('Bread');
    });
});

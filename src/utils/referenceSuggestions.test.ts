import { describe, expect, it } from 'vitest';
import { findReferenceQuery, rankReferenceCandidates, referenceInsertion, referencePathFor } from './referenceSuggestions';

describe('reference suggestions', () => {
    it('finds the reference being typed, including optional references', () => {
        expect(findReferenceQuery('- @./')).toEqual({ start: 3, query: '' });
        expect(findReferenceQuery('Lunch @./Recept/Krämig gn')).toEqual({ start: 7, query: 'Recept/Krämig gn' });
        expect(findReferenceQuery('@?./sauce')).toEqual({ start: 2, query: 'sauce' });
    });

    it('ignores finished references, plain ingredients and email-like text', () => {
        expect(findReferenceQuery('@./Recept/Pizzasallad{} and ')).toBeNull();
        expect(findReferenceQuery('@salt')).toBeNull();
        expect(findReferenceQuery('a@b./c')).toBeNull();
    });

    it('writes vault-root paths without the recipe extension', () => {
        expect(referencePathFor('Recept/Krämig gnocchi med salsiccia.cook')).toBe('./Recept/Krämig gnocchi med salsiccia');
        expect(referencePathFor('Recept/Mac & Cheese.cook.cook')).toBe('./Recept/Mac & Cheese.cook');
        expect(referencePathFor('Rice.cook.md')).toBe('./Rice');
        expect(referencePathFor('Notes/Rice.md')).toBe('./Notes/Rice');
    });

    it('adds braces with the cursor inside, unless braces follow already', () => {
        expect(referenceInsertion('Recept/Pizzasallad.cook', '')).toEqual({ text: './Recept/Pizzasallad{}', cursorOffset: 21 });
        expect(referenceInsertion('Recept/Pizzasallad.cook', '{2}')).toEqual({ text: './Recept/Pizzasallad', cursorOffset: 21 });
    });

    it('matches every word regardless of case and accents, name prefixes first', () => {
        const files = [
            'Recept/Litauiska pannkakor.cook',
            'Recept/Krämig gnocchi med salsiccia.cook',
            'Recept/Litauiska zeppelinare (Cepelinai).cook',
            'Pannkakor/Amerikanska.cook',
        ].map(path => ({ path }));
        const names = (query: string) => rankReferenceCandidates(query, files).map(file => file.path);

        expect(names('kramig')).toEqual(['Recept/Krämig gnocchi med salsiccia.cook']);
        expect(names('recept/lit zep')).toEqual(['Recept/Litauiska zeppelinare (Cepelinai).cook']);
        expect(names('pann')).toEqual(['Recept/Litauiska pannkakor.cook', 'Pannkakor/Amerikanska.cook']);
        expect(names('')).toHaveLength(4);
        expect(rankReferenceCandidates('', files, 2)).toHaveLength(2);
    });
});

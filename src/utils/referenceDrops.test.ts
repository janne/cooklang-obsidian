import { describe, expect, it } from 'vitest';
import { referenceDropText, vaultPathsFromObsidianUrls } from './referenceDrops';

describe('reference drops', () => {
    it('inserts a reference, padded only where it touches text', () => {
        expect(referenceDropText(['Recept/Mac & Cheese.cook.cook'], '', ''))
            .toEqual({ text: '@./Recept/Mac & Cheese.cook{}', cursorOffset: 29 });
        expect(referenceDropText(['Recept/Pizzasallad.cook'], 'd', ','))
            .toEqual({ text: ' @./Recept/Pizzasallad{} ', cursorOffset: 24 });
        expect(referenceDropText(['Recept/Pizzasallad.cook'], ' ', '\n').text).toBe('@./Recept/Pizzasallad{}');
    });

    it('puts several dropped recipes on their own lines', () => {
        expect(referenceDropText(['A.cook', 'Notes/B.md'], 'x', '').text).toBe('\n@./A{}\n@./Notes/B{}');
        expect(referenceDropText(['A.cook', 'B.cook'], '', '')).toEqual({ text: '@./A{}\n@./B{}', cursorOffset: 13 });
    });

    it('reads vault paths from Obsidian links and ignores other text', () => {
        const links = [
            'obsidian://open?vault=Jan%27s%20notes&file=Recept%2FKr%C3%A4mig%20gnocchi%20med%20salsiccia.cook',
            'https://example.com',
            'obsidian://open?vault=Jan%27s%20notes&file=Recept%2FMarkdown%20rice',
        ].join('\n');
        expect(vaultPathsFromObsidianUrls(links)).toEqual(['Recept/Krämig gnocchi med salsiccia.cook', 'Recept/Markdown rice']);
        expect(vaultPathsFromObsidianUrls('[[Mac & Cheese.cook.cook]]')).toEqual([]);
    });
});

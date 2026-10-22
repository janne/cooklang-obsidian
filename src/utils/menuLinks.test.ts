import { describe, expect, it } from 'vitest';
import { findWikiLinks, menuLinkText, menuSuffixStart } from './menuLinks';

describe('menu links', () => {
    it('finds plain, aliased and subpath links but not embeds', () => {
        const line = '- [ ] [[Vecka 43.menu]] och [[Julmeny-25.menu|jul]] ![[Vecka 42.menu]] [[Vecka 43.menu#Måndag]]';
        expect(findWikiLinks(line)).toEqual([
            { from: 6, to: 23, target: 'Vecka 43.menu', decorated: false },
            { from: 28, to: 51, target: 'Julmeny-25.menu', decorated: true },
            { from: 71, to: 95, target: 'Vecka 43.menu', decorated: true },
        ]);
    });

    it('locates and strips the menu suffix only', () => {
        expect(menuSuffixStart('Recept/Vecka 43.menu')).toBe(15);
        expect(menuSuffixStart('Vecka 43.menu.md')).toBe(8);
        expect(menuSuffixStart('Saftiga kanelbullar.cook')).toBeNull();
        expect(menuLinkText('Vecka 43.menu')).toBe('Vecka 43');
        expect(menuLinkText('Vecka 43.menu.md')).toBe('Vecka 43');
        expect(menuLinkText('Saftiga kanelbullar.cook')).toBe('Saftiga kanelbullar.cook');
    });
});

import { describe, expect, it } from 'vitest';
import {
    createWeightConverter,
    formatGramRange,
    formatGrams,
    parseWeightTable,
    weightsFileCandidates,
    weightsYamlSource,
} from './weightConversion';

function converter(data: unknown) {
    return createWeightConverter(parseWeightTable(data).table);
}

describe('parseWeightTable', () => {
    it('reads grams_per_100ml with a list or single alias', () => {
        const { table, errors } = parseWeightTable({
            Couscous: { grams_per_100ml: 73 },
            currypasta: { grams_per_100ml: 101, aliases: ['Grön currypasta', 'röd currypasta'] },
            socker: { grams_per_100ml: '85', aliases: 'strösocker' },
        });
        expect(errors).toEqual([]);
        expect(table.entries.get('couscous')).toBe(0.73);
        expect(table.entries.get('grön currypasta')).toBe(1.01);
        expect(table.entries.get('strösocker')).toBe(0.85);
    });

    it('reports entries without a valid grams_per_100ml and keeps the rest', () => {
        const { table, errors } = parseWeightTable({
            couscous: { grams_per_100ml: 73 },
            salt: { grams_per_100ml: 'mycket' },
            mjöl: 0.53,
            smör: { density: 0.91, units: { msk: 14 } },
        });
        expect([...table.entries.keys()]).toEqual(['couscous']);
        expect(errors).toEqual([
            'salt: grams_per_100ml must be a positive number.',
            'mjöl: grams_per_100ml must be a positive number.',
            'smör: grams_per_100ml must be a positive number.',
        ]);
    });

    it('treats an empty document as an empty table and rejects lists', () => {
        expect(parseWeightTable(null).errors).toEqual([]);
        expect(parseWeightTable(['couscous']).errors).toHaveLength(1);
    });
});

describe('createWeightConverter', () => {
    const weights = converter({
        vetemjöl: { grams_per_100ml: 53, aliases: ['flour'] },
        tomat: { grams_per_100ml: 60 },
        bean: { grams_per_100ml: 80 },
    });

    it('converts volume units and rounds to whole grams', () => {
        expect(weights.toGrams(['vetemjöl'], 2, 'dl')).toBe(106);
        expect(weights.toGrams(['Flour'], 1, 'cup')).toBe(125);
        expect(weights.toGrams(['flour'], 2, 'cups')).toBe(251);
        expect(weights.toGrams(['vetemjöl'], 3, 'msk')).toBe(24);
        expect(weights.toGrams(['vetemjöl'], 1, 'tsk')).toBe(3);
    });

    it('matches plurals and tries each name in order', () => {
        expect(weights.toGrams(['beans'], 1, 'dl')).toBe(80);
        expect(weights.toGrams(['tomates'], 1, 'dl')).toBe(60);
        expect(weights.toGrams(['okänd', 'vetemjöl'], 1, 'dl')).toBe(53);
    });

    it('converts mass units without a table entry', () => {
        expect(weights.toGrams(['anything'], 1, 'lb')).toBe(454);
        expect(weights.toGrams(['anything'], 1.5, 'kg')).toBe(1500);
        expect(weights.isMass('oz')).toBe(true);
        expect(weights.isMass('dl')).toBe(false);
    });

    it('reads T as tablespoon rather than tonne', () => {
        expect(weights.toGrams(['vetemjöl'], 1, 'T')).toBe(8);
    });

    it('returns null for counts, unknown ingredients or units, and zero results', () => {
        expect(weights.toGrams(['tomat'], 2, null)).toBeNull();
        expect(weights.toGrams(['salt'], 1, 'tsp')).toBeNull();
        expect(weights.toGrams(['vetemjöl'], 1, 'nypa')).toBeNull();
        expect(weights.toGrams(['vetemjöl'], 1, 'krm')).toBe(1);
        expect(weights.toGrams(['vetemjöl'], 0.5, 'krm')).toBeNull();
        expect(weights.toGrams(['vetemjöl'], 0, 'dl')).toBeNull();
    });
});

describe('weights file location and source', () => {
    it('tries the path as written, then with .md like a wikilink', () => {
        expect(weightsFileCandidates('Recept/Tabeller/weights.yaml')).toEqual([
            'Recept/Tabeller/weights.yaml',
            'Recept/Tabeller/weights.yaml.md',
        ]);
        expect(weightsFileCandidates(' /Recept/weights.yaml.md ')).toEqual(['Recept/weights.yaml.md']);
        expect(weightsFileCandidates('  ')).toEqual([]);
    });

    it('drops fence lines and keeps everything else', () => {
        const yaml = 'couscous:\n  grams_per_100ml: 73';
        expect(weightsYamlSource(yaml)).toBe(yaml);
        expect(weightsYamlSource('```yaml\ncouscous:\n  grams_per_100ml: 73\n```\n')).toBe(`${yaml}\n`);
        expect(weightsYamlSource('~~~yml\r\ncouscous:\r\n  grams_per_100ml: 73\r\n~~~')).toBe(yaml);
    });
});

describe('gram formatting', () => {
    it('switches to kilograms at 1000 g with gram precision', () => {
        expect(formatGrams(999.4)).toBe('999 g');
        expect(formatGrams(1000)).toBe('1 kg');
        expect(formatGrams(1234)).toBe('1.234 kg');
        expect(formatGrams(2500.2)).toBe('2.5 kg');
    });

    it('keeps a range in one unit when both ends share it', () => {
        expect(formatGramRange(200, 300)).toBe('200–300 g');
        expect(formatGramRange(1000, 1500)).toBe('1–1.5 kg');
        expect(formatGramRange(800, 1200)).toBe('800 g–1.2 kg');
        expect(formatGramRange(1000.2, 999.8)).toBe('1 kg');
    });
});

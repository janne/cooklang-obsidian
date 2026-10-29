import { describe, expect, it, vi } from 'vitest';
import { WeightTableLoader } from './WeightTableLoader';

function host(files: Record<string, string>, parseYaml = (text: string) => JSON.parse(text)) {
    return {
        read: vi.fn(async (path: string) => files[path] ?? null),
        parseYaml,
        changed: vi.fn(),
    };
}

describe('WeightTableLoader', () => {
    it('loads a table and notifies listeners', async () => {
        const h = host({ 'weights.yaml': '{"flour": {"grams_per_100ml": 50}}' });
        const loader = new WeightTableLoader(h);
        const status = await loader.load('weights.yaml');
        expect(status).toEqual({ path: 'weights.yaml', entries: 1, errors: [] });
        expect(loader.weights?.toGrams(['flour'], 1, 'dl')).toBe(50);
        expect(h.changed).toHaveBeenCalledTimes(1);
    });

    it('clears the table when the path is empty or missing', async () => {
        const loader = new WeightTableLoader(host({ 'weights.yaml': '{"flour": {"grams_per_100ml": 50}}' }));
        await loader.load('weights.yaml');
        await loader.load('');
        expect(loader.weights).toBeNull();
        expect(loader.status).toBeNull();
        const missing = await loader.load('nope.yaml');
        expect(loader.weights).toBeNull();
        expect(missing?.errors[0]).toContain('nope.yaml');
    });

    it('reports YAML errors without throwing', async () => {
        const loader = new WeightTableLoader(host({ 'bad.yaml': '{' }));
        const status = await loader.load('bad.yaml');
        expect(loader.weights).toBeNull();
        expect(status?.errors).toHaveLength(1);
    });

    it('ignores a stale load that finishes after a newer one', async () => {
        let releaseSlow!: (text: string) => void;
        const h = {
            read: vi.fn((path: string) => path === 'slow.yaml'
                ? new Promise<string>(resolve => { releaseSlow = resolve; })
                : Promise.resolve('{"sugar": {"grams_per_100ml": 80}}')),
            parseYaml: (text: string) => JSON.parse(text),
            changed: vi.fn(),
        };
        const loader = new WeightTableLoader(h);
        const slow = loader.load('slow.yaml');
        await loader.load('fast.yaml');
        releaseSlow('{"flour": {"grams_per_100ml": 50}}');
        await slow;
        expect(loader.status?.path).toBe('fast.yaml');
        expect(loader.weights?.toGrams(['flour'], 1, 'dl')).toBeNull();
        expect(h.changed).toHaveBeenCalledTimes(1);
    });

    it('reads the yaml block of a note, with or without the .md suffix', async () => {
        const note = '# Vikter\n\n```yaml\n{"couscous": {"grams_per_100ml": 73}}\n```\n';
        const h = host({ 'Tabeller/weights.yaml.md': note });
        const loader = new WeightTableLoader(h);
        expect(await loader.load('Tabeller/weights.yaml')).toEqual({ path: 'Tabeller/weights.yaml.md', entries: 1, errors: [] });
        expect(loader.weights?.toGrams(['couscous'], 1, 'dl')).toBe(73);
        expect(await loader.load('Tabeller/weights.yaml.md')).toEqual({ path: 'Tabeller/weights.yaml.md', entries: 1, errors: [] });
    });

    it('reports a note without a yaml block', async () => {
        const loader = new WeightTableLoader(host({ 'weights.md': 'No table here' }));
        const status = await loader.load('weights');
        expect(loader.weights).toBeNull();
        expect(status?.errors).toEqual(['No ```yaml block found in weights.md']);
    });
});

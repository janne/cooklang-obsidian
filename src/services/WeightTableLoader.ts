import {
    createWeightConverter,
    parseWeightTable,
    weightsFileCandidates,
    weightsYamlSource,
    type WeightConverter,
} from '../utils/weightConversion';

export interface WeightTableHost {
    /** File contents, or null when no file exists at the path. */
    read(path: string): Promise<string | null>;
    parseYaml(text: string): unknown;
    changed(): void;
}

export interface WeightTableStatus {
    path: string;
    /** Number of ingredient names (including aliases) loaded. */
    entries: number;
    errors: string[];
}

/** Loads the configured weights file; an older load never replaces a newer one. */
export class WeightTableLoader {
    private revision = 0;
    private converter: WeightConverter | null = null;
    status: WeightTableStatus | null = null;

    constructor(private host: WeightTableHost) {}

    get weights(): WeightConverter | null { return this.converter; }

    async load(path: string): Promise<WeightTableStatus | null> {
        const revision = ++this.revision;
        const candidates = weightsFileCandidates(path);
        let converter: WeightConverter | null = null;
        let status: WeightTableStatus | null = null;
        if (candidates.length) {
            let resolved = candidates[0]!;
            try {
                let text: string | null = null;
                for (const candidate of candidates) {
                    text = await this.host.read(candidate);
                    if (text !== null) { resolved = candidate; break; }
                }
                if (text === null) {
                    status = { path: resolved, entries: 0, errors: [`File not found: ${resolved}`] };
                } else {
                    const { table, errors } = parseWeightTable(this.host.parseYaml(weightsYamlSource(text)));
                    converter = createWeightConverter(table);
                    status = { path: resolved, entries: table.entries.size, errors };
                }
            } catch (error) {
                status = { path: resolved, entries: 0,
                    errors: [`Could not load ${resolved}: ${error instanceof Error ? error.message : String(error)}`] };
            }
        }
        if (revision !== this.revision) return this.status;
        this.converter = converter;
        this.status = status;
        this.host.changed();
        return status;
    }
}

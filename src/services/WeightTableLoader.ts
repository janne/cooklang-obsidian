import {
    createWeightConverter,
    parseWeightTable,
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
        const trimmed = path.trim();
        let converter: WeightConverter | null = null;
        let status: WeightTableStatus | null = null;
        if (trimmed) {
            try {
                const text = await this.host.read(trimmed);
                if (text === null) {
                    status = { path: trimmed, entries: 0, errors: [`File not found: ${trimmed}`] };
                } else {
                    const { table, errors } = parseWeightTable(this.host.parseYaml(text));
                    converter = createWeightConverter(table);
                    status = { path: trimmed, entries: table.entries.size, errors };
                }
            } catch (error) {
                status = { path: trimmed, entries: 0,
                    errors: [`Could not load ${trimmed}: ${error instanceof Error ? error.message : String(error)}`] };
            }
        }
        if (revision !== this.revision) return this.status;
        this.converter = converter;
        this.status = status;
        this.host.changed();
        return status;
    }
}

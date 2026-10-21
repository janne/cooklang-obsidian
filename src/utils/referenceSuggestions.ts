/**
 * Pure helpers for autocompleting recipe references (`@./Folder/Recipe{}`).
 *
 * References are written from the vault root without an extension; the
 * resolver tries `.cook`, a marked `.md`, then `.cook.md` for that stem.
 */
import { recipeStem } from './recipeFiles';

export interface ReferenceQuery {
    /** Column where `./` starts; the replacement keeps the `@` or `@?` before it. */
    start: number;
    /** Text typed after `./`. */
    query: string;
}

const OPEN_REFERENCE = /@\??(\.\/[^{}\n]*)$/;

/** The reference being typed at the end of `lineBeforeCursor`, if any. */
export function findReferenceQuery(lineBeforeCursor: string): ReferenceQuery | null {
    const match = OPEN_REFERENCE.exec(lineBeforeCursor);
    if (!match) return null;
    return { start: lineBeforeCursor.length - match[1].length, query: match[1].slice(2) };
}

/** `Recept/Mac & Cheese.cook.cook` becomes `./Recept/Mac & Cheese.cook`. */
export function referencePathFor(filePath: string): string {
    return `./${recipeStem(filePath)}`;
}

/** Text replacing `./query`: braces are added unless the source already has them. */
export function referenceInsertion(filePath: string, textAfterCursor: string): { text: string; cursorOffset: number } {
    const path = referencePathFor(filePath);
    return textAfterCursor.startsWith('{')
        ? { text: path, cursorOffset: path.length + 1 }
        : { text: `${path}{}`, cursorOffset: path.length + 1 };
}

/** Case- and accent-insensitive, so `kramig` finds `Krämig`. */
function normalize(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Candidates whose stem contains every query word (split on spaces and `/`),
 * ranked by name prefix, then name match, then path match, then alphabetically.
 */
export function rankReferenceCandidates<T extends { path: string }>(query: string, candidates: T[], limit = 50): T[] {
    const words = normalize(query).split(/[\s/]+/).filter(Boolean);
    const scored = candidates.flatMap(candidate => {
        const stem = recipeStem(candidate.path);
        const path = normalize(stem);
        if (!words.every(word => path.includes(word))) return [];
        const name = normalize(stem.split('/').pop() ?? stem);
        const first = words[0] ?? '';
        const rank = !first ? 0 : name.startsWith(first) ? 0 : name.includes(first) ? 1 : 2;
        return [{ candidate, rank, stem }];
    });
    scored.sort((a, b) => a.rank - b.rank || a.stem.localeCompare(b.stem));
    return scored.slice(0, limit).map(entry => entry.candidate);
}

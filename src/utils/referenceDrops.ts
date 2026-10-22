/**
 * Pure helpers for dropping recipe files into a menu as references.
 */
import { referencePathFor } from './referenceSuggestions';

/**
 * The text inserted for dropped recipes: one `@./…{}` reference each, on its
 * own line when several are dropped, padded with a space where it would
 * otherwise run into adjacent text.
 */
export function referenceDropText(filePaths: string[], charBefore: string, charAfter: string): { text: string; cursorOffset: number } {
    const references = filePaths.map(path => `@${referencePathFor(path)}{}`).join('\n');
    const separator = filePaths.length > 1 ? '\n' : ' ';
    const before = charBefore && !/\s/.test(charBefore) ? separator : '';
    const after = charAfter && !/\s/.test(charAfter) ? separator : '';
    // The cursor lands after the last reference, before any padding.
    return { text: `${before}${references}${after}`, cursorOffset: before.length + references.length };
}

/**
 * Vault paths from the `obsidian://open?vault=…&file=…` links Obsidian puts on
 * a file drag, one per line. Paths may omit a Markdown file's `.md` suffix.
 */
export function vaultPathsFromObsidianUrls(text: string): string[] {
    return text.split(/\r?\n/).flatMap(line => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('obsidian://open?')) return [];
        try {
            const file = new URL(trimmed).searchParams.get('file');
            return file ? [file] : [];
        } catch {
            return [];
        }
    });
}

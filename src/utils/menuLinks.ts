/**
 * Display names for wiki links to menus. A link to a non-Markdown file must
 * spell out its extension (`[[Vecka 43.menu]]`, also the form Obsidian writes
 * for `Vecka 43.menu.md`), so Obsidian shows the suffix in the link text.
 */

const MENU_SUFFIX = /\.menu(?:\.md)?$/i;

export interface WikiLink {
    /** Column of `[[`. */
    from: number;
    /** Column after `]]`. */
    to: number;
    /** The linked path as written, without subpath or alias. */
    target: string;
    /** True with `#heading`, `#^block` or `|alias`; such links keep their text. */
    decorated: boolean;
}

const WIKI_LINK = /(!?)\[\[([^[\]|#^]+)([#^][^[\]|]*)?(\|[^[\]]*)?\]\]/g;

/** Wiki links on a line, excluding `![[embeds]]`. */
export function findWikiLinks(line: string): WikiLink[] {
    return [...line.matchAll(WIKI_LINK)].flatMap(match => match[1] ? [] : [{
        from: match.index,
        to: match.index + match[0].length,
        target: match[2],
        decorated: Boolean(match[3] || match[4]),
    }]);
}

/** Offset of `.menu` / `.menu.md` within a link target, or null. */
export function menuSuffixStart(target: string): number | null {
    const match = MENU_SUFFIX.exec(target);
    return match ? match.index : null;
}

/** `Vecka 43.menu` shows as `Vecka 43`; other text is unchanged. */
export function menuLinkText(text: string): string {
    return text.replace(MENU_SUFFIX, '');
}

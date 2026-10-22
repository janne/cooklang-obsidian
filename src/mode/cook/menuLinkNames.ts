import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import { findWikiLinks, menuSuffixStart } from '../../utils/menuLinks';

const hidden = Decoration.replace({});

/**
 * In Live Preview, `[[Vecka 43.menu]]` reads as `Vecka 43`, as a Markdown note's
 * link hides `.md`. Like the brackets, the suffix shows again while the cursor
 * is in the link, and Source mode always shows it.
 */
export function menuLinkNames(isMenuLink: (linkpath: string, sourcePath: string) => boolean) {
    return ViewPlugin.fromClass(class {
        decorations: DecorationSet = Decoration.none;

        constructor(view: EditorView) { this.decorations = this.build(view); }

        update(update: ViewUpdate): void {
            if (update.docChanged || update.viewportChanged || update.selectionSet
                || update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false)) {
                this.decorations = this.build(update.view);
            }
        }

        private build(view: EditorView): DecorationSet {
            if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
            const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? '';
            const { selection } = view.state;
            const ranges: Range<Decoration>[] = [];
            for (const { from, to } of view.visibleRanges) {
                for (let position = from; position <= to;) {
                    const line = view.state.doc.lineAt(position);
                    if (line.text.includes('[[')) {
                        for (const link of findWikiLinks(line.text)) {
                            const suffix = menuSuffixStart(link.target);
                            const start = line.from + link.from;
                            const end = line.from + link.to;
                            if (link.decorated || suffix === null || suffix === 0) continue;
                            if (selection.ranges.some(range => range.from <= end && range.to >= start)) continue;
                            if (!isMenuLink(link.target, sourcePath)) continue;
                            const target = start + 2;
                            ranges.push(hidden.range(target + suffix, target + link.target.length));
                        }
                    }
                    position = line.to + 1;
                }
            }
            return Decoration.set(ranges, true);
        }
    }, { decorations: plugin => plugin.decorations });
}

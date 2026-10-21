import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { editorInfoField, Keymap, parseYaml } from 'obsidian';
import type { RecipeRefTarget } from '../../utils/ingredientAggregator';
import { isRecipeSource } from '../../utils/recipeSource';
import { findSourceReferences, referenceAt } from '../../utils/sourceReferences';
import { cookHighlightRanges } from './highlightRanges';

/** Opens a reference followed from the source; `sourcePath` is the file being edited. */
export type OpenSourceReference = (sourcePath: string, target: RecipeRefTarget) => void;

const referenceMark = Decoration.mark({ class: 'cook-source-reference' });

function referenceRanges(view: EditorView): Range<Decoration>[] {
    const ranges: Range<Decoration>[] = [];
    for (let number = 1; number <= view.state.doc.lines; number++) {
        const line = view.state.doc.line(number);
        if (!line.text.includes('@')) continue;
        for (const reference of findSourceReferences(line.text)) {
            ranges.push(referenceMark.range(line.from + reference.from, line.from + reference.to));
        }
    }
    return ranges;
}

export function nativeCookEditor(onEligibilityChange: () => void, openReference?: OpenSourceReference) {
    return ViewPlugin.fromClass(class {
        decorations: DecorationSet = Decoration.none;
        path = '';
        eligible = false;

        constructor(view: EditorView) { this.refresh(view); }

        update(update: ViewUpdate): void {
            const path = update.state.field(editorInfoField, false)?.file?.path ?? '';
            if (update.docChanged || path !== this.path) this.refresh(update.view);
        }

        private refresh(view: EditorView): void {
            const path = view.state.field(editorInfoField, false)?.file?.path ?? '';
            const source = view.state.doc.toString();
            const eligible = isRecipeSource(path, source, parseYaml);
            if (path !== this.path || eligible !== this.eligible) onEligibilityChange();
            this.path = path;
            this.eligible = eligible;
            this.decorations = eligible
                ? Decoration.set([
                    ...cookHighlightRanges(source).map(({ from, to, classes }) =>
                        Decoration.mark({ class: classes }).range(from, to)),
                    ...(openReference ? referenceRanges(view) : []),
                ], true)
                : Decoration.none;
        }
    }, {
        decorations: plugin => plugin.decorations,
        eventHandlers: {
            // Mod+click follows a reference, as Obsidian follows links in Source mode. Handling
            // mousedown keeps CodeMirror from adding a second cursor for the same gesture.
            mousedown(event: MouseEvent, view: EditorView) {
                if (!openReference || !this.eligible || event.button !== 0 || !Keymap.isModifier(event, 'Mod')) return false;
                const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
                if (position === null) return false;
                const line = view.state.doc.lineAt(position);
                const reference = referenceAt(line.text, position - line.from);
                if (!reference) return false;
                event.preventDefault();
                openReference(this.path, reference.target);
                return true;
            },
        },
    });
}

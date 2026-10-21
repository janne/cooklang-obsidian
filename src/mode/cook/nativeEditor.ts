import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { Prec, type Range } from '@codemirror/state';
import { editorInfoField, Keymap, parseYaml, type MarkdownFileInfo } from 'obsidian';
import type { RecipeRefTarget } from '../../utils/ingredientAggregator';
import { isRecipeSource } from '../../utils/recipeSource';
import { findSourceReferences, referenceAt } from '../../utils/sourceReferences';
import { cookHighlightRanges } from './highlightRanges';

const referencePathMark = Decoration.mark({ class: 'cook-source-reference' });
const referenceSyntaxMark = Decoration.mark({ class: 'cook-source-reference-syntax' });

/** Like `[[links]]`: the path reads as the link, `@` and `{…}` as dimmed syntax. */
function referenceRanges(view: EditorView): Range<Decoration>[] {
    const ranges: Range<Decoration>[] = [];
    for (let number = 1; number <= view.state.doc.lines; number++) {
        const line = view.state.doc.line(number);
        if (!line.text.includes('@')) continue;
        for (const reference of findSourceReferences(line.text)) {
            ranges.push(
                referenceSyntaxMark.range(line.from + reference.from, line.from + reference.pathFrom),
                referencePathMark.range(line.from + reference.pathFrom, line.from + reference.pathTo),
                referenceSyntaxMark.range(line.from + reference.pathTo, line.from + reference.to),
            );
        }
    }
    return ranges;
}

export function nativeCookEditor(onEligibilityChange: () => void) {
    return ViewPlugin.fromClass(class {
        decorations: DecorationSet = Decoration.none;
        private path = '';
        private eligible = false;

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
                    ...referenceRanges(view),
                ], true)
                : Decoration.none;
        }
    }, { decorations: plugin => plugin.decorations });
}

export interface SourceReferenceHandlers {
    /** Follows a reference; `sourcePath` is the file being edited. */
    open(sourcePath: string, target: RecipeRefTarget): void;
    /** Offers Obsidian's page preview for a hovered reference. */
    hover(sourcePath: string, target: RecipeRefTarget, event: MouseEvent, targetEl: HTMLElement, info: MarkdownFileInfo | null): void;
}

function referenceAtEvent(view: EditorView, event: MouseEvent) {
    const info = view.state.field(editorInfoField, false) ?? null;
    const path = info?.file?.path ?? '';
    if (!path || !isRecipeSource(path, view.state.doc.toString(), parseYaml)) return null;
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null) return null;
    const line = view.state.doc.lineAt(position);
    const reference = referenceAt(line.text, position - line.from);
    return reference ? { info, path, reference } : null;
}

/**
 * Like `[[links]]` in Source mode: Mod+click follows a reference and hovering
 * offers a page preview. Highest precedence lets Mod+mousedown run before the
 * host editor adds a second cursor for the same gesture.
 */
export function sourceReferenceEvents(handlers: SourceReferenceHandlers) {
    return Prec.highest(EditorView.domEventHandlers({
        mousedown(event, view) {
            if (event.button !== 0 || !Keymap.isModifier(event, 'Mod')) return false;
            const found = referenceAtEvent(view, event);
            if (!found) return false;
            event.preventDefault();
            handlers.open(found.path, found.reference.target);
            return true;
        },
        mouseover(event, view) {
            const targetEl = event.target instanceof Element ? event.target.closest<HTMLElement>('.cook-source-reference') : null;
            if (!targetEl) return false;
            const found = referenceAtEvent(view, event);
            if (found) handlers.hover(found.path, found.reference.target, event, targetEl, found.info);
            return false;
        },
    }));
}

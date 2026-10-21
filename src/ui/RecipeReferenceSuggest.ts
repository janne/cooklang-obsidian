import {
    App,
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    TFile,
} from 'obsidian';
import { isMenuFile, isRecipeFile, recipeName, recipeStem } from '../utils/recipeFiles';
import { findReferenceQuery, rankReferenceCandidates, referenceInsertion } from '../utils/referenceSuggestions';

/** Autocompletes recipe references (`@` in menus, `@./` in recipes), on desktop and mobile. */
export class RecipeReferenceSuggest extends EditorSuggest<TFile> {
    constructor(app: App) {
        super(app);
        this.limit = 50;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        if (!file || !this.isRecipe(file)) return null;
        const reference = findReferenceQuery(editor.getLine(cursor.line).slice(0, cursor.ch), isMenuFile(file.path));
        return reference
            ? { start: { line: cursor.line, ch: reference.start }, end: cursor, query: reference.query }
            : null;
    }

    getSuggestions(context: EditorSuggestContext): TFile[] {
        // Menus compose recipes; a recipe referencing itself or a menu cannot be expanded.
        const candidates = this.app.vault.getFiles()
            .filter(file => file !== context.file && !isMenuFile(file.path) && this.isRecipe(file));
        return rankReferenceCandidates(context.query, candidates, this.limit);
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        el.addClass('cook-reference-suggestion');
        el.createDiv({ cls: 'cook-reference-suggestion-name', text: recipeName(file.path) });
        const folder = recipeStem(file.path).split('/').slice(0, -1).join('/');
        if (folder) el.createDiv({ cls: 'cook-reference-suggestion-path', text: folder });
    }

    selectSuggestion(file: TFile): void {
        const context = this.context;
        if (!context) return;
        const { editor, start, end } = context;
        const insertion = referenceInsertion(file.path, editor.getLine(end.line).slice(end.ch));
        editor.replaceRange(insertion.text, start, end);
        editor.setCursor({ line: start.line, ch: start.ch + insertion.cursorOffset });
        this.close();
    }

    /** Only plain `.md` files need their properties; this runs for every vault file per keystroke. */
    private isRecipe(file: TFile): boolean {
        return isRecipeFile(file.path) || (file.extension === 'md'
            && isRecipeFile(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter));
    }
}

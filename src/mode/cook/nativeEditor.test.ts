// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { StreamLanguage, language } from '@codemirror/language';
import { editorInfoField, type MarkdownFileInfo } from 'obsidian';
import { nativeCookEditor, sourceReferenceEvents, type SourceReferenceHandlers } from './nativeEditor';

vi.mock('obsidian', async () => {
    const { StateField } = await import('@codemirror/state');
    return {
        editorInfoField: StateField.define({ create: () => null, update: value => value }),
        parseYaml: JSON.parse,
        Keymap: { isModifier: (event: MouseEvent) => event.metaKey },
    };
});

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.destroy(); });

function setup(path: string, source: string, handlers?: SourceReferenceHandlers) {
    const changed = vi.fn();
    const extension = nativeCookEditor(changed);
    const info = { file: { path } } as MarkdownFileInfo;
    const hostLanguage = StreamLanguage.define({ token: stream => { stream.skipToEnd(); return 'comment'; } });
    const view = new EditorView({ state: EditorState.create({ doc: source,
        extensions: [hostLanguage, editorInfoField.init(() => info), extension,
            handlers ? sourceReferenceEvents(handlers) : []] }) });
    views.push(view);
    return { view, info, changed, hostLanguage, decorations: () => view.plugin(extension)!.decorations };
}

describe('native editor decorations', () => {
    it('keeps the host language while applying and updating Cooklang marks', () => {
        const { view, decorations, hostLanguage } = setup('Dinner.cook', 'Mix @rice in #pot.');
        expect(decorations().size).toBe(2);
        expect(view.state.facet(language)).toBe(hostLanguage);
        view.dispatch({ changes: { from: 4, to: 9, insert: '@Möhre{2%g}' } });
        expect(decorations().size).toBe(3);
        expect(view.state.facet(language)).toBe(hostLanguage);
    });

    it('rechecks associated file changes even when text does not change', () => {
        const { view, info, decorations } = setup('Dinner.cook', 'Mix @rice.');
        expect(decorations().size).toBe(1);
        info.file!.path = 'Dinner.md';
        view.dispatch({});
        expect(decorations().size).toBe(0);
        info.file!.path = 'Dinner.cook.md';
        view.dispatch({});
        expect(decorations().size).toBe(1);
    });

    it('activates and deactivates immediately for unsaved Boolean property edits', () => {
        const source = '---\n{"recipe":false}\n---\n@rice';
        const { view, changed, decorations } = setup('Dinner.md', source);
        expect(decorations().size).toBe(0);
        view.dispatch({ changes: { from: 0, to: source.length, insert: source.replace('false', 'true') } });
        expect(decorations().size).toBeGreaterThan(0);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
        expect(decorations().size).toBe(0);
        expect(changed).toHaveBeenCalledTimes(3);
    });

    it('marks references like links and follows one on Mod+click', () => {
        const handlers = { open: vi.fn(), hover: vi.fn(), droppedRecipes: vi.fn(() => null) };
        const source = 'Dinner: @./Recept/Pizzasallad{2} and @salt';
        const { view, decorations, info } = setup('Week.menu', source, handlers);
        const marks: string[] = [];
        decorations().between(0, source.length, (from, to, value) => {
            if (String(value.spec.class).startsWith('cook-source-reference')) marks.push(`${value.spec.class}:${source.slice(from, to)}`);
        });
        expect(marks.sort()).toEqual([
            'cook-source-reference-syntax:@',
            'cook-source-reference-syntax:{2}',
            'cook-source-reference:./Recept/Pizzasallad',
        ]);

        view.posAtCoords = () => source.indexOf('Pizza');
        const target = { name: 'Pizzasallad', components: ['.', 'Recept'], quantity: 2, unit: null };
        const click = (metaKey: boolean) => view.contentDOM.dispatchEvent(
            new MouseEvent('mousedown', { button: 0, metaKey, bubbles: true, cancelable: true }));
        click(false);
        expect(handlers.open).not.toHaveBeenCalled();
        click(true);
        expect(handlers.open).toHaveBeenCalledWith('Week.menu', target);

        const link = view.contentDOM.querySelector('.cook-source-reference')!;
        link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        expect(handlers.hover).toHaveBeenCalledWith('Week.menu', target, expect.any(MouseEvent), link, info);
    });

    it('inserts dropped recipes as references in menus only', () => {
        const dropped = vi.fn<(event: DragEvent) => string[] | null>(() => ['Recept/Pizzasallad.cook']);
        const handlers = { open: vi.fn(), hover: vi.fn(), droppedRecipes: dropped };
        const drop = (view: EditorView, position: number) => {
            view.posAtCoords = () => position;
            const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
            view.contentDOM.dispatchEvent(event);
            return event;
        };

        const menu = setup('Week.menu', 'Dinner: and more', handlers);
        expect(drop(menu.view, 7).defaultPrevented).toBe(true);
        expect(menu.view.state.doc.toString()).toBe('Dinner: @./Recept/Pizzasallad{} and more');
        expect(menu.view.state.selection.main.head).toBe(31);

        dropped.mockReturnValue(null);
        expect(drop(menu.view, 0).defaultPrevented).toBe(false);

        dropped.mockReturnValue(['Recept/Pizzasallad.cook']);
        const recipe = setup('Dinner.cook', 'Mix @rice.', handlers);
        expect(drop(recipe.view, 0).defaultPrevented).toBe(false);
        expect(recipe.view.state.doc.toString()).toBe('Mix @rice.');
    });
});

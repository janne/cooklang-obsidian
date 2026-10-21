// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { StreamLanguage, language } from '@codemirror/language';
import { editorInfoField, type MarkdownFileInfo } from 'obsidian';
import { nativeCookEditor } from './nativeEditor';

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

function setup(path: string, source: string, openReference?: Parameters<typeof nativeCookEditor>[1]) {
    const changed = vi.fn();
    const extension = nativeCookEditor(changed, openReference);
    const info = { file: { path } } as MarkdownFileInfo;
    const hostLanguage = StreamLanguage.define({ token: stream => { stream.skipToEnd(); return 'comment'; } });
    const view = new EditorView({ state: EditorState.create({ doc: source,
        extensions: [hostLanguage, editorInfoField.init(() => info), extension] }) });
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

    it('marks complete references and follows one on Mod+click', () => {
        const open = vi.fn();
        const source = 'Dinner: @./Recept/Pizzasallad{2} and @salt';
        const { view, decorations } = setup('Week.menu', source, open);
        const classes: string[] = [];
        decorations().between(0, source.length, (from, to, value) => {
            if (value.spec.class === 'cook-source-reference') classes.push(source.slice(from, to));
        });
        expect(classes).toEqual(['@./Recept/Pizzasallad{2}']);

        const position = source.indexOf('Pizza');
        view.posAtCoords = () => position;
        const click = (metaKey: boolean) => view.contentDOM.dispatchEvent(
            new MouseEvent('mousedown', { button: 0, metaKey, bubbles: true, cancelable: true }));
        click(false);
        expect(open).not.toHaveBeenCalled();
        click(true);
        expect(open).toHaveBeenCalledWith('Week.menu',
            { name: 'Pizzasallad', components: ['.', 'Recept'], quantity: 2, unit: null });
    });
});

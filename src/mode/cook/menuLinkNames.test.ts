// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField, type MarkdownFileInfo } from 'obsidian';
import { menuLinkNames } from './menuLinkNames';

vi.mock('obsidian', async () => {
    const { StateField } = await import('@codemirror/state');
    return {
        editorInfoField: StateField.define({ create: () => null, update: value => value }),
        editorLivePreviewField: StateField.define({ create: () => false, update: value => value }),
    };
});

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.destroy(); });

function setup(source: string, livePreview: boolean, cursor = 0) {
    const isMenuLink = vi.fn((linkpath: string) => linkpath.startsWith('Vecka'));
    const extension = menuLinkNames(isMenuLink);
    const view = new EditorView({ state: EditorState.create({
        doc: source,
        selection: EditorSelection.cursor(cursor),
        extensions: [
            editorInfoField.init(() => ({ file: { path: 'Notes/Todo.md' } } as MarkdownFileInfo)),
            editorLivePreviewField.init(() => livePreview),
            extension,
        ],
    }) });
    views.push(view);
    const hiddenText = () => {
        const parts: string[] = [];
        view.plugin(extension)!.decorations.between(0, source.length, (from, to) => { parts.push(source.slice(from, to)); });
        return parts;
    };
    return { view, hiddenText, isMenuLink };
}

describe('menu link names', () => {
    const source = 'Plan: [[Vecka 43.menu]] and [[Saftiga.cook]] and [[Vecka 44.menu|nästa]]\nnext line';

    it('hides the suffix of plain menu links in Live Preview', () => {
        const { hiddenText, isMenuLink } = setup(source, true, source.length);
        expect(hiddenText()).toEqual(['.menu']);
        expect(isMenuLink).toHaveBeenCalledWith('Vecka 43.menu', 'Notes/Todo.md');
    });

    it('shows the suffix while the cursor is in the link, and in Source mode', () => {
        expect(setup(source, true, 10).hiddenText()).toEqual([]);
        expect(setup(source, false, source.length).hiddenText()).toEqual([]);
    });
});

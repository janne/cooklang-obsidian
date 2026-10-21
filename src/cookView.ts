import { TFile, TextFileView, WorkspaceLeaf, type ViewStateResult, type Menu, Scope } from 'obsidian';
import type { CooklangSettings } from './settings';
import { parserService } from './services/ParserService';
import type { RecipeSession } from './services/RecipeSessions';
import { parseServingsValue, computeScale, computeReferenceScale, deriveServingsState,
    type RecipeReferenceScaleRequest } from './utils/scaling';
import { mount, unmount } from 'svelte';
import { writable } from 'svelte/store';
import CookViewRoot from './ui/CookViewRoot.svelte';
import type { CombinedIngredientsState, MenuRenderState, RecipeHostAdapter, RecipeRenderModel } from './ui/types';
import { isMenuFile, recipeName } from './utils/recipeFiles';
import { buildCombinedIngredients, type CombinedRecipe } from './utils/combinedIngredients';
import { findRecipeImages } from './utils/imageHelpers';
import { getRecipeImageUrls } from './utils/recipeImages';
import { localDateKey } from './utils/menuModel';

const COMBINED_REFRESH_DELAY = 250;

/** Interactive preview only. Obsidian owns every source editor. */
export class CookView extends TextFileView {
    private previewStore = writable<RecipeRenderModel | null>(null);
    private component: ReturnType<typeof mount>;
    private disposed = false;
    private currentSession: RecipeSession | null = null;
    /** A menu's combined ingredients, keyed by path, scale and source. */
    private combined: {
        key: string;
        state: CombinedIngredientsState;
        dependencies: Set<string>;
        images: Record<string, string>;
    } | null = null;
    private combinedGeneration = 0;
    private combinedRefresh: number | null = null;

    constructor(leaf: WorkspaceLeaf, private settings: CooklangSettings,
        private acquireSession: (path: string) => RecipeSession,
        private editSource: (leaf: WorkspaceLeaf) => Promise<void>,
        private host: RecipeHostAdapter) {
        super(leaf);
        this.component = mount(CookViewRoot, { target: this.contentEl, props: { preview: this.previewStore } });
        this.scope = new Scope(this.app.scope);
        this.scope.register(['Mod'], 'e', () => { void this.editSource(this.leaf); return false; });
    }

    private get session(): RecipeSession | null {
        this.currentSession = this.file ? this.acquireSession(this.file.path) : null;
        return this.currentSession;
    }

    async onload(): Promise<void> {
        super.onload();
        this.addAction('edit-3', 'Edit recipe source', () => { void this.editSource(this.leaf); });
        // Referenced recipes can change, appear, or move while a menu is open.
        this.registerEvent(this.app.vault.on('modify', file => {
            if (this.combined?.dependencies.has(file.path)) this.refreshCombined();
        }));
        this.registerEvent(this.app.vault.on('create', () => this.refreshCombined()));
        this.registerEvent(this.app.vault.on('delete', () => this.refreshCombined()));
        this.registerEvent(this.app.vault.on('rename', () => this.refreshCombined()));
        this.register(() => {
            if (this.combinedRefresh !== null) window.clearTimeout(this.combinedRefresh);
        });
        await parserService.initialize();
        if (!this.disposed) this.renderPreview();
    }

    onunload(): void {
        this.disposed = true;
        void unmount(this.component);
        // The plugin's session registry owns timers and checklist state.
    }

    onPaneMenu(menu: Menu, source: string): void {
        super.onPaneMenu(menu, source);
        menu.addItem(item => item.setTitle('Edit recipe source').setIcon('file-pen')
            .onClick(() => this.editSource(this.leaf)));
    }

    getViewData(): string { return this.data ?? ''; }

    setViewData(data: string, clear: boolean): void {
        if (clear) this.previewStore.set(null);
        this.data = data;
        this.renderPreview();
    }

    clear(): void {
        this.previewStore.set(null);
        this.data = '';
        this.currentSession = null;
        this.combined = null;
        this.combinedGeneration++;
    }

    getDisplayText(): string { return this.file ? recipeName(this.file.path) : 'Cooklang (no file)'; }
    // New navigation must go through the registered native view and routing policy.
    // Otherwise Obsidian reuses this preview for unrelated Markdown notes.
    canAcceptExtension(_extension: string): boolean { return false; }
    getViewType(): string { return 'cook'; }
    getIcon(): string { return this.file && isMenuFile(this.file.path) ? 'document-menu' : 'document-cook'; }

    getState(): Record<string, unknown> {
        const session = this.currentSession;
        return { ...super.getState(), mode: 'preview', scale: session?.scale ?? 1,
            currentStep: session?.currentStep ?? -1 };
    }

    async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
        await super.setState(state, result);
        if (this.disposed) return;
        const session = this.session;
        if (session) {
            if (typeof state.scale === 'number' && Number.isFinite(state.scale) && state.scale > 0) session.scale = state.scale;
            if (typeof state.currentStep === 'number' && Number.isInteger(state.currentStep)) session.currentStep = state.currentStep;
            if (isReferenceScaleRequest(state.referenceScale)) session.pendingReferenceScale = state.referenceScale;
        }
        // Migrate previously persisted standalone source editors after setState completes.
        if (state.mode === 'source') {
            const file = this.file;
            window.setTimeout(() => {
                if (!this.disposed && this.file === file) void this.editSource(this.leaf);
            }, 0);
            return;
        }
        this.renderPreview();
    }

    renderPreview(): void {
        if (this.disposed || typeof this.data !== 'string' || !parserService.isReady()) return;
        const session = this.session;
        if (!session) return;
        let [recipe] = parserService.parse(this.data, session.scale);
        const [baseRecipe] = parserService.parse(this.data);
        if (session.pendingReferenceScale) {
            session.scale = computeReferenceScale(session.pendingReferenceScale,
                baseRecipe.servings, baseRecipe.rawMetadata.get('yield'));
            session.pendingReferenceScale = null;
            [recipe] = parserService.parse(this.data, session.scale);
        }
        const isMenu = !!this.file && isMenuFile(this.file.path);
        // The parser reports absent servings as null. A menu then counts as one serving,
        // so its scale always has a visible control acting as the plan multiplier.
        const { baseServings, displayServings } = deriveServingsState(
            parseServingsValue(isMenu ? baseRecipe.servings ?? undefined : baseRecipe.servings), session.scale);
        const menu: MenuRenderState | undefined = isMenu && this.file
            ? { today: localDateKey(new Date()), combined: this.combinedState(this.file, this.data, session.scale),
                images: this.combined?.images ?? {} }
            : undefined;
        this.previewStore.set({
            instanceId: session.instanceId, interactive: true, recipe, file: this.file, menu,
            settings: this.settings, host: this.host, timers: session.timers,
            state: { scale: session.scale, baseServings, displayServings,
                checkedIngredients: session.checkedIngredients, currentStep: session.currentStep },
            callbacks: {
                onScaleChange: target => {
                    if (baseServings == null) return;
                    session.scale = computeScale(target, baseServings);
                    this.renderPreview();
                },
                onIngredientToggle: name => {
                    if (session.checkedIngredients.has(name)) session.checkedIngredients.delete(name);
                    else session.checkedIngredients.add(name);
                    this.renderPreview();
                },
                onStepActivate: index => {
                    session.currentStep = session.currentStep === index ? -1 : index;
                    this.renderPreview();
                },
            },
        });
    }

    /** Starts a rebuild when the inputs changed, keeping the previous list visible meanwhile. */
    private combinedState(file: TFile, source: string, scale: number): CombinedIngredientsState {
        const key = `${file.path}\u0000${scale}\u0000${source}`;
        if (this.combined?.key === key) return this.combined.state;
        const generation = ++this.combinedGeneration;
        const state: CombinedIngredientsState = this.combined?.state.status === 'ready'
            ? this.combined.state : { status: 'loading' };
        this.combined = { key, state, dependencies: this.combined?.dependencies ?? new Set(), images: this.combined?.images ?? {} };
        const images: Record<string, string> = {};
        const finish = (next: CombinedIngredientsState, dependencies: string[]): void => {
            if (this.disposed || generation !== this.combinedGeneration) return;
            this.combined = { key, state: next, dependencies: new Set(dependencies), images };
            this.renderPreview();
        };
        buildCombinedIngredients(file.path, source, scale, {
            parse: (text, factor) => parserService.parse(text, factor)[0],
            read: async path => {
                const target = this.app.vault.getAbstractFileByPath(path);
                if (!(target instanceof TFile)) throw new Error(`${path} does not exist.`);
                return this.app.vault.cachedRead(target);
            },
            resolve: reference => this.host.resolveReference(file, reference)?.targetPath ?? null,
            visit: (path, recipe) => {
                const image = this.recipeImageUrl(path, recipe);
                if (image) images[path] = image;
            },
        }).then(
            list => finish({ status: 'ready', list }, list.dependencies),
            error => finish({ status: 'error', message: error instanceof Error ? error.message : String(error) }, []),
        );
        return state;
    }

    /** As in the recipe's own header: a sibling image file first, then `image` metadata. */
    private recipeImageUrl(path: string, recipe: CombinedRecipe): string | null {
        const file = this.app.vault.getAbstractFileByPath(path);
        const sibling = file instanceof TFile ? findRecipeImages(file).mainImage : null;
        return sibling ? this.app.vault.getResourcePath(sibling) : getRecipeImageUrls(recipe.images)[0] ?? null;
    }

    private refreshCombined(): void {
        if (this.disposed || !this.file || !isMenuFile(this.file.path) || this.combinedRefresh !== null) return;
        this.combinedRefresh = window.setTimeout(() => {
            this.combinedRefresh = null;
            if (this.combined) this.combined.key = '';
            this.renderPreview();
        }, COMBINED_REFRESH_DELAY);
    }

    updateSettings(settings: CooklangSettings): void {
        this.settings = settings;
        this.renderPreview();
    }
}

function isReferenceScaleRequest(value: unknown): value is RecipeReferenceScaleRequest {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<RecipeReferenceScaleRequest>;
    return typeof candidate.quantity === 'number' && Number.isFinite(candidate.quantity)
        && (typeof candidate.unit === 'string' || candidate.unit === null);
}

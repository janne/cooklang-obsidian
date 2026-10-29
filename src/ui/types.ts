import type { CooklangRecipe } from '@cooklang/cooklang';
import type { TFile } from 'obsidian';
import type { Readable } from 'svelte/store';
import type { CooklangSettings } from '../settings';
import type { RecipeRefTarget } from '../utils/ingredientAggregator';
import type { TimerSnapshot } from '../services/TimerService';
import type { RecipeReferenceScaleRequest } from '../utils/scaling';
import type { MeasureMode, WeightConverter } from '../utils/weightConversion';

export interface PreviewState {
    scale: number;
    baseServings: number | null;
    displayServings: number | null;
    checkedIngredients: Set<string>;
    currentStep: number;
    measure: MeasureMode;
}

export interface PreviewCallbacks {
    onScaleChange: (targetServings: number) => void;
    onIngredientToggle: (ingredientName: string) => void;
    onStepActivate: (globalStepIndex: number) => void;
    onMeasureChange: (measure: MeasureMode) => void;
}

export interface ResolvedRecipeReference {
    targetPath: string;
    sourcePath: string;
    scaleRequest: RecipeReferenceScaleRequest | null;
}

export interface RecipeHostAdapter {
    getResourcePath(file: TFile): string;
    resolveReference(sourceFile: TFile | null, ref: RecipeRefTarget): ResolvedRecipeReference | null;
    openReference(reference: ResolvedRecipeReference): void;
    openWikiLink(sourcePath: string, linktext: string): void;
}

export interface TimerController {
    toggle(key: string, seconds: number, label: string): void;
    reset(key: string): void;
    subscribe(key: string, listener: (snapshot: TimerSnapshot | null) => void): () => void;
}

export interface RecipeRenderModel {
    instanceId: string;
    interactive: boolean;
    recipe: CooklangRecipe;
    file: TFile | null;
    settings: CooklangSettings;
    state: PreviewState;
    callbacks: PreviewCallbacks;
    host: RecipeHostAdapter;
    timers: TimerController | null;
    /** Conversion table from the weights file, or null when none is configured. */
    weights: WeightConverter | null;
}

/** The converter to apply to displayed amounts, honouring the volume/weight choice. */
export function activeWeights(model: RecipeRenderModel): WeightConverter | null {
    return model.state.measure === 'weight' ? model.weights : null;
}

export type EmbedRenderState =
    | { status: 'loading' }
    | { status: 'empty' }
    | { status: 'error'; message: string; source: string }
    | { status: 'ready'; model: RecipeRenderModel };

export interface CookViewRootProps {
    preview: Readable<RecipeRenderModel | null>;
}

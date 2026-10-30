import type { CooklangRecipe } from '@cooklang/cooklang';
import type { TFile } from 'obsidian';
import type { Readable } from 'svelte/store';
import type { CooklangSettings } from '../settings';
import type { RecipeRefTarget } from '../utils/ingredientAggregator';
import type { TimerSnapshot } from '../services/TimerService';
import type { RecipeReferenceScaleRequest } from '../utils/scaling';
import type { MeasureMode, WeightConverter } from '../utils/weightConversion';
import type { WeightsFor } from '../utils/ingredientRows';

export interface PreviewState {
    scale: number;
    baseServings: number | null;
    displayServings: number | null;
    checkedIngredients: Set<string>;
    currentStep: number;
    measure: MeasureMode;
    /** Ingredients (by display name) shown in the opposite measure to `measure`. */
    flippedMeasures: Set<string>;
}

export interface PreviewCallbacks {
    onScaleChange: (targetServings: number) => void;
    onIngredientToggle: (ingredientName: string) => void;
    onStepActivate: (globalStepIndex: number) => void;
    onMeasureChange: (measure: MeasureMode) => void;
    onIngredientMeasureToggle: (ingredientName: string) => void;
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

/** Whether an ingredient shows as weight, honouring the global choice and its own toggle. */
export function showsWeight(model: RecipeRenderModel, ingredientName: string): boolean {
    return (model.state.measure === 'weight') !== model.state.flippedMeasures.has(ingredientName);
}

/** The converter for each ingredient's displayed amount. */
export function weightsFor(model: RecipeRenderModel): WeightsFor {
    return name => showsWeight(model, name) ? model.weights : null;
}

export type EmbedRenderState =
    | { status: 'loading' }
    | { status: 'empty' }
    | { status: 'error'; message: string; source: string }
    | { status: 'ready'; model: RecipeRenderModel };

export interface CookViewRootProps {
    preview: Readable<RecipeRenderModel | null>;
}

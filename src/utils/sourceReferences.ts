/**
 * Recipe references in Cooklang source text, for following them from the editor.
 * Only complete references count: the parser ignores `@./…` without braces.
 */
import type { RecipeRefTarget } from './ingredientAggregator';

export interface SourceReference {
    /** Column of `@`. */
    from: number;
    /** Column after the closing `}`. */
    to: number;
    target: RecipeRefTarget;
}

const REFERENCE = /@\??(\.\/[^{}@\n]*?)\s*\{([^{}\n]*)\}/g;

/** `1/2`, `1.5`, `6%servings`, or `=2`; anything else is the recipe as written. */
function parseAmount(amount: string): Pick<RecipeRefTarget, 'quantity' | 'unit'> {
    const [rawValue, ...unitParts] = amount.replace(/^\s*=/, '').split('%');
    const value = rawValue.trim();
    const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(value);
    const quantity = fraction
        ? Number(fraction[1]) / Number(fraction[2])
        : /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
    if (!Number.isFinite(quantity) || quantity <= 0) return { quantity: null, unit: null };
    const unit = unitParts.join('%').trim();
    return { quantity, unit: unit || null };
}

/** `./Recept/Mac & Cheese.cook` becomes name `Mac & Cheese.cook` in components `['.', 'Recept']`. */
function parsePath(path: string): Pick<RecipeRefTarget, 'name' | 'components'> {
    const parts = path.split('/');
    return { name: parts.pop()?.trim() ?? '', components: parts };
}

export function findSourceReferences(line: string): SourceReference[] {
    return [...line.matchAll(REFERENCE)].map(match => ({
        from: match.index,
        to: match.index + match[0].length,
        target: { ...parsePath(match[1]), ...parseAmount(match[2]) },
    })).filter(reference => reference.target.name);
}

/** The reference containing column `ch`, including its edges. */
export function referenceAt(line: string, ch: number): SourceReference | null {
    return findSourceReferences(line).find(reference => reference.from <= ch && ch <= reference.to) ?? null;
}

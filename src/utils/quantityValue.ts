/**
 * Extract a numeric value from a raw WASM Quantity.
 *
 * The library's getQuantityValue returns NaN for fraction quantities because a
 * fraction's value is an object ({whole, num, den}), not a number. This reads
 * both representations:
 *   regular:  { type: 'number', value: { type: 'regular',  value: 5.5 } }
 *   fraction: { type: 'number', value: { type: 'fraction', value: { whole, num, den } } }
 * Range / text quantities return null (they aren't summable).
 *
 * Duck-typed (`any`) so it can be unit-tested without the WASM runtime.
 */
export function numericFromQuantity(quantity: any): number | null {
    const value = quantity?.value;
    if (!value || value.type !== 'number') return null;
    return numericFromNumber(value.value);
}

/**
 * Extract the endpoints of a range quantity:
 *   { type: 'range', value: { start: <number>, end: <number> } }
 * where each endpoint is a regular or fraction number as above.
 */
export function rangeFromQuantity(quantity: any): { start: number; end: number } | null {
    const value = quantity?.value;
    if (!value || value.type !== 'range') return null;
    const start = numericFromNumber(value.value?.start);
    const end = numericFromNumber(value.value?.end);
    return start !== null && end !== null ? { start, end } : null;
}

function numericFromNumber(inner: any): number | null {
    if (inner?.type === 'regular') {
        const n = Number(inner.value);
        return Number.isFinite(n) ? n : null;
    }
    if (inner?.type === 'fraction') {
        const f = inner.value;
        if (f && typeof f.den === 'number' && f.den !== 0) {
            const n = (f.whole ?? 0) + (f.num ?? 0) / f.den;
            return Number.isFinite(n) ? n : null;
        }
    }
    return null;
}

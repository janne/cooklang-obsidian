import { describe, expect, it } from 'vitest';
import { ScreenWakeLock, type WakeLockProvider, type WakeLockSentinelLike } from './ScreenWakeLock';

class FakeSentinel implements WakeLockSentinelLike {
    released = false;
    async release(): Promise<void> { this.released = true; }
}

function fakeProvider(options: { reject?: boolean } = {}) {
    const sentinels: FakeSentinel[] = [];
    const pending: (() => void)[] = [];
    const provider: WakeLockProvider = {
        request: () => new Promise((resolve, reject) => {
            pending.push(() => {
                if (options.reject) return reject(new Error('NotAllowedError'));
                const sentinel = new FakeSentinel();
                sentinels.push(sentinel);
                resolve(sentinel);
            });
        }),
    };
    const settle = async () => {
        while (pending.length) pending.shift()!();
        await Promise.resolve();
        await Promise.resolve();
    };
    return { provider, sentinels, pending, settle };
}

describe('ScreenWakeLock', () => {
    it('acquires once while wanted and releases when no longer wanted', async () => {
        const fake = fakeProvider();
        const lock = new ScreenWakeLock(fake.provider, () => true);

        lock.setWanted(true);
        lock.setWanted(true);
        expect(fake.pending).toHaveLength(1);
        await fake.settle();
        lock.setWanted(true);
        expect(fake.sentinels).toHaveLength(1);
        expect(fake.sentinels[0].released).toBe(false);

        lock.setWanted(false);
        expect(fake.sentinels[0].released).toBe(true);
    });

    it('releases a lock that arrives after it stopped being wanted', async () => {
        const fake = fakeProvider();
        const lock = new ScreenWakeLock(fake.provider, () => true);

        lock.setWanted(true);
        lock.setWanted(false);
        await fake.settle();

        expect(fake.sentinels[0].released).toBe(true);
    });

    it('requests again when the app becomes visible after the system released it', async () => {
        const fake = fakeProvider();
        let visible = true;
        const lock = new ScreenWakeLock(fake.provider, () => visible);

        lock.setWanted(true);
        await fake.settle();
        visible = false;
        fake.sentinels[0].released = true;
        lock.handleVisibilityChange();
        expect(fake.pending).toHaveLength(0);

        visible = true;
        lock.handleVisibilityChange();
        await fake.settle();
        expect(fake.sentinels).toHaveLength(2);
        expect(fake.sentinels[1].released).toBe(false);
    });

    it('does not request while hidden', () => {
        const fake = fakeProvider();
        const lock = new ScreenWakeLock(fake.provider, () => false);

        lock.setWanted(true);

        expect(fake.pending).toHaveLength(0);
    });

    it('does not retry a rejected request until the next state change', async () => {
        const fake = fakeProvider({ reject: true });
        const lock = new ScreenWakeLock(fake.provider, () => true);

        lock.setWanted(true);
        await fake.settle();
        expect(fake.pending).toHaveLength(0);

        lock.handleVisibilityChange();
        expect(fake.pending).toHaveLength(1);
    });

    it('does nothing without Wake Lock support', () => {
        const lock = new ScreenWakeLock(undefined, () => true);

        expect(() => lock.setWanted(true)).not.toThrow();
    });

    it('releases on dispose', async () => {
        const fake = fakeProvider();
        const lock = new ScreenWakeLock(fake.provider, () => true);

        lock.setWanted(true);
        await fake.settle();
        lock.dispose();

        expect(fake.sentinels[0].released).toBe(true);
    });
});

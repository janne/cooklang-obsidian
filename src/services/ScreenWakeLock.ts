export interface WakeLockSentinelLike {
    readonly released: boolean;
    release(): Promise<void>;
}

export interface WakeLockProvider {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * Keeps the screen awake while it is wanted and the document is visible. The
 * system releases the lock whenever the app is hidden, so callers report
 * visibility changes and the lock is requested again on return.
 */
export class ScreenWakeLock {
    private wanted = false;
    private sentinel: WakeLockSentinelLike | null = null;
    private requesting = false;

    constructor(
        private readonly provider: WakeLockProvider | undefined,
        private readonly isVisible: () => boolean,
    ) {}

    setWanted(wanted: boolean): void {
        this.wanted = wanted;
        this.sync();
    }

    handleVisibilityChange(): void {
        this.sync();
    }

    dispose(): void {
        this.setWanted(false);
    }

    private sync(): void {
        if (this.wanted && this.isVisible()) {
            if (this.provider && !this.requesting && (!this.sentinel || this.sentinel.released)) {
                this.acquire(this.provider);
            }
        } else if (this.sentinel) {
            const sentinel = this.sentinel;
            this.sentinel = null;
            if (!sentinel.released) void sentinel.release().catch(() => undefined);
        }
    }

    private acquire(provider: WakeLockProvider): void {
        this.requesting = true;
        // A rejected request is not retried until the next state change, so a
        // denied permission cannot cause a request loop.
        provider.request('screen').then(sentinel => {
            this.requesting = false;
            this.sentinel = sentinel;
            this.sync();
        }, () => {
            this.requesting = false;
        });
    }
}

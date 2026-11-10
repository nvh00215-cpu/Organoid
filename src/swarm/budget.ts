/** Shared per-run call budget with a protected reserve for the final round. */
export const DEFAULT_MAX_CALLS = 120
export const DEFAULT_RESERVE_CALLS = 8

export class CallBudget {
  private calls = 0
  private approxTokens = 0
  private reserveReleased = false
  private readonly maxCalls: number
  private readonly reserveCalls: number

  constructor(maxCalls = DEFAULT_MAX_CALLS, reserveCalls = DEFAULT_RESERVE_CALLS) {
    this.maxCalls = maxCalls
    this.reserveCalls = reserveCalls
  }

  getMaxCalls(): number {
    return this.maxCalls
  }

  getCalls(): number {
    return this.calls
  }

  getApproxTokens(): number {
    return this.approxTokens
  }

  /** Reserve one call. Fails inside the protected reserve until released. */
  tryReserve(): boolean {
    const limit = this.reserveReleased ? this.maxCalls : this.maxCalls - this.reserveCalls
    if (this.calls >= limit) return false
    this.calls += 1
    return true
  }

  /** Open the protected reserve (the runner calls this at the final checkpoint). */
  releaseReserve(): void {
    this.reserveReleased = true
  }

  recordTokens(approxTokens: number): void {
    this.approxTokens += approxTokens
  }
}

/** Shared per-run call budget with a protected reserve for the final round. */
export class CallBudget {
  private calls = 0
  private approxTokens = 0
  private reserveReleased = false
  private readonly maxCalls: number
  private readonly reserveCalls: number

  constructor(maxCalls = 120, reserveCalls = 8) {
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

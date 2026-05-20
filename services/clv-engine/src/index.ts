export class ClvEngine {
  calculate(signalOdds: number, closingOdds: number): number {
    return closingOdds === 0 ? 0 : (signalOdds - closingOdds) / closingOdds;
  }
}

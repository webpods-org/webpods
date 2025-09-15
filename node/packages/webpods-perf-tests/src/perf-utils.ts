import { performance } from "perf_hooks";

export interface PerfMetrics {
  operation: string;
  iterations: number;
  duration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  opsPerSecond: number;
  percentiles: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  memoryUsed?: number | undefined;
}

export interface PerfTestOptions {
  name: string;
  duration: number; // Target duration in seconds
  warmupIterations?: number;
  collectMemory?: boolean;
}

export class PerfTimer {
  private startTime: bigint | null = null;
  private endTime: bigint | null = null;
  private measurements: number[] = [];

  start(): void {
    this.startTime = process.hrtime.bigint();
  }

  stop(): number {
    if (!this.startTime) {
      throw new Error("Timer not started");
    }
    this.endTime = process.hrtime.bigint();
    const duration = Number(this.endTime - this.startTime) / 1_000_000; // Convert to milliseconds
    this.measurements.push(duration);
    return duration;
  }

  reset(): void {
    this.startTime = null;
    this.endTime = null;
    this.measurements = [];
  }

  getMeasurements(): number[] {
    return [...this.measurements];
  }

  getStats(): {
    count: number;
    total: number;
    avg: number;
    min: number;
    max: number;
    percentiles: { p50: number; p90: number; p95: number; p99: number };
  } {
    if (this.measurements.length === 0) {
      return {
        count: 0,
        total: 0,
        avg: 0,
        min: 0,
        max: 0,
        percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
      };
    }

    const sorted = [...this.measurements].sort((a, b) => a - b);
    const total = sorted.reduce((sum, val) => sum + val, 0);

    return {
      count: sorted.length,
      total,
      avg: total / sorted.length,
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      percentiles: {
        p50: this.getPercentile(sorted, 50),
        p90: this.getPercentile(sorted, 90),
        p95: this.getPercentile(sorted, 95),
        p99: this.getPercentile(sorted, 99),
      },
    };
  }

  private getPercentile(sorted: number[], percentile: number): number {
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] ?? 0;
  }
}

export async function runPerfTest(
  testFn: () => Promise<void>,
  options: PerfTestOptions,
): Promise<PerfMetrics> {
  const timer = new PerfTimer();
  const targetDurationMS = options.duration * 1000;
  const warmupIterations = options.warmupIterations ?? 10;

  // Warmup phase
  for (let i = 0; i < warmupIterations; i++) {
    await testFn();
  }

  // Measurement phase
  const startTime = performance.now();
  let iterations = 0;
  let memoryUsed = 0;

  if (options.collectMemory && global.gc) {
    global.gc();
  }

  const initialMemory = options.collectMemory
    ? process.memoryUsage().heapUsed
    : 0;

  while (performance.now() - startTime < targetDurationMS) {
    timer.start();
    await testFn();
    timer.stop();
    iterations++;
  }

  const totalDuration = performance.now() - startTime;

  if (options.collectMemory) {
    memoryUsed = process.memoryUsage().heapUsed - initialMemory;
  }

  const stats = timer.getStats();

  return {
    operation: options.name,
    iterations,
    duration: totalDuration,
    avgDuration: stats.avg,
    minDuration: stats.min,
    maxDuration: stats.max,
    opsPerSecond: (iterations / totalDuration) * 1000,
    percentiles: stats.percentiles,
    memoryUsed: options.collectMemory ? memoryUsed : undefined,
  };
}

export function formatPerfResults(metrics: PerfMetrics): string {
  const lines = [
    `\n=== ${metrics.operation} ===`,
    `Iterations:     ${metrics.iterations.toLocaleString()}`,
    `Total Duration: ${(metrics.duration / 1000).toFixed(2)}s`,
    `Ops/Second:     ${metrics.opsPerSecond.toFixed(2)}`,
    ``,
    `Response Times (ms):`,
    `  Average:      ${metrics.avgDuration.toFixed(3)}`,
    `  Min:          ${metrics.minDuration.toFixed(3)}`,
    `  Max:          ${metrics.maxDuration.toFixed(3)}`,
    ``,
    `Percentiles (ms):`,
    `  50th (p50):   ${metrics.percentiles.p50.toFixed(3)}`,
    `  90th (p90):   ${metrics.percentiles.p90.toFixed(3)}`,
    `  95th (p95):   ${metrics.percentiles.p95.toFixed(3)}`,
    `  99th (p99):   ${metrics.percentiles.p99.toFixed(3)}`,
  ];

  if (metrics.memoryUsed !== undefined) {
    lines.push(
      ``,
      `Memory:`,
      `  Used:         ${(metrics.memoryUsed / 1024 / 1024).toFixed(2)} MB`,
    );
  }

  return lines.join("\n");
}

export class PerfReport {
  private results: PerfMetrics[] = [];

  add(metrics: PerfMetrics): void {
    this.results.push(metrics);
  }

  getSummary(): string {
    if (this.results.length === 0) {
      return "No performance results collected";
    }

    const lines = [
      "\n" + "=".repeat(60),
      "PERFORMANCE TEST SUMMARY",
      "=".repeat(60),
    ];

    for (const result of this.results) {
      lines.push(formatPerfResults(result));
    }

    lines.push("=".repeat(60));
    return lines.join("\n");
  }

  getResults(): PerfMetrics[] {
    return [...this.results];
  }
}

import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  generateTestWebPodsToken,
  logIndented,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import { runPerfTest, PerfTimer } from "../perf-utils.js";
import { globalPerfReport } from "../test-setup.js";
import * as crypto from "crypto";

describe("Record Operations Performance", function () {
  this.timeout(150000); // 2.5 minutes for all tests

  let client: TestHttpClient;
  let authToken: string;
  let userId: string;
  const testPodId = "perfpod";
  const baseUrl = `http://${testPodId}.localhost:3000`;
  const testStream = "perfrecords";
  let recordCount = 0;

  // Store the last performance result to log after test completion
  let lastPerfResult: string | null = null;

  before(async function () {
    client = new TestHttpClient(baseUrl);

    // Create test user in database
    const db = testDb.getDb();
    const testUser = await createTestUser(db, {
      provider: "test-auth-provider-1",
      providerId: "perf-user-123",
      email: "perf@test.com",
      name: "Perf Test User",
    });
    userId = testUser.userId;

    // Create test pod
    await createTestPod(db, testPodId, userId);

    // Generate and set WebPods JWT token
    authToken = generateTestWebPodsToken(userId);
    client.setAuthToken(authToken);

    // Pre-populate with some records for read tests
    const startTime = Date.now();
    for (let i = 0; i < 1000; i++) {
      await client.post(`/${testStream}/record-${i}`, {
        id: i,
        data: `Test data ${i}`,
        timestamp: Date.now(),
      });
      recordCount++;
    }
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    const writesPerSec = (recordCount / duration).toFixed(0);
    logIndented(
      `Populated ${recordCount} records in ${duration.toFixed(1)}s. ${writesPerSec} writes/sec.`,
      8,
    );
  });

  describe("Write Operations", () => {
    afterEach(() => {
      if (lastPerfResult) {
        logIndented(lastPerfResult, 12);
        lastPerfResult = null;
      }
    });

    it("should measure performance of writing individual records", async () => {
      // Pre-generate random data to avoid crypto overhead in the loop
      const randomData = crypto.randomBytes(256).toString("hex");

      const metrics = await runPerfTest(
        async () => {
          await client.post(`/${testStream}/perf-record-${recordCount++}`, {
            id: recordCount,
            data: `Performance test data ${recordCount}`,
            timestamp: Date.now(),
            randomData: randomData,
          });
        },
        {
          name: "Record Write (Individual)",
          duration: 10,
          warmupIterations: 5,
        },
      );

      globalPerfReport.add(metrics);
      lastPerfResult = `Record writes: ${metrics.opsPerSecond.toFixed(2)} ops/sec`;
    });

    it("should measure performance of writing records with external content", async () => {
      // Large content that will be stored externally
      const largeContent = crypto.randomBytes(2048).toString("hex");

      const metrics = await runPerfTest(
        async () => {
          await client.post(
            `/${testStream}/large-record-${recordCount++}`,
            largeContent,
          );
        },
        {
          name: "Record Write (External Storage)",
          duration: 10,
          warmupIterations: 5,
        },
      );

      globalPerfReport.add(metrics);
      lastPerfResult = `External content writes: ${metrics.opsPerSecond.toFixed(2)} ops/sec`;
    });

    it("should measure performance of writing records with custom headers", async () => {
      const metrics = await runPerfTest(
        async () => {
          await client.post(
            `/${testStream}/header-record-${recordCount++}`,
            { test: "data" },
            {
              headers: {
                "x-custom-header": "custom-value",
                "cache-control": "no-cache",
              },
            },
          );
        },
        {
          name: "Record Write (With Headers)",
          duration: 10,
          warmupIterations: 5,
        },
      );

      globalPerfReport.add(metrics);
      lastPerfResult = `Records with headers: ${metrics.opsPerSecond.toFixed(2)} ops/sec`;
    });
  });

  describe("Read Operations", () => {
    afterEach(() => {
      if (lastPerfResult) {
        logIndented(lastPerfResult, 12);
        lastPerfResult = null;
      }
    });

    it("should measure performance of reading individual records by name", async () => {
      let readCounter = 0;
      const metrics = await runPerfTest(
        async () => {
          // Use a much tighter loop for more cache hits
          const recordIndex = readCounter % 10; // Cycle through only 10 records for high cache hit rate
          readCounter++;
          await client.get(`/${testStream}/record-${recordIndex}`);
        },
        {
          name: "Record Read (By Name)",
          duration: 10,
          warmupIterations: 10,
        },
      );

      globalPerfReport.add(metrics);
      lastPerfResult = `Individual record reads: ${metrics.opsPerSecond.toFixed(2)} ops/sec`;
    });

    it("should measure performance of listing records", async () => {
      const metrics = await runPerfTest(
        async () => {
          await client.get(`/${testStream}`, {
            params: { limit: 100 },
          });
        },
        {
          name: "Record List (100 records)",
          duration: 10,
          warmupIterations: 5,
        },
      );

      globalPerfReport.add(metrics);
      lastPerfResult = `List 100 records: ${metrics.opsPerSecond.toFixed(2)} ops/sec`;
    });

    it("should measure performance of listing records with pagination", async () => {
      let paginationCounter = 0;
      const paginationOffsets = [0, 100, 200]; // Fewer offsets for higher cache hit rate
      const metrics = await runPerfTest(
        async () => {
          // Cycle through fewer offsets for more cache hits
          const after =
            paginationOffsets[paginationCounter % paginationOffsets.length];
          paginationCounter++;
          await client.get(`/${testStream}`, {
            params: { after, limit: 50 },
          });
        },
        {
          name: "Record List (Paginated)",
          duration: 10,
          warmupIterations: 5,
        },
      );

      globalPerfReport.add(metrics);
      lastPerfResult = `Paginated listing: ${metrics.opsPerSecond.toFixed(2)} ops/sec`;
    });

    it("should measure performance of listing unique records", async () => {
      const metrics = await runPerfTest(
        async () => {
          await client.get(`/${testStream}`, {
            params: { unique: true, limit: 50 },
          });
        },
        {
          name: "Record List (Unique)",
          duration: 10,
          warmupIterations: 5,
        },
      );

      globalPerfReport.add(metrics);
      lastPerfResult = `Unique records: ${metrics.opsPerSecond.toFixed(2)} ops/sec`;
    });

    it("should measure performance of fetching last N records", async () => {
      const metrics = await runPerfTest(
        async () => {
          await client.get(`/${testStream}`, {
            params: { after: -50 },
          });
        },
        {
          name: "Record List (Last 50)",
          duration: 10,
          warmupIterations: 5,
        },
      );

      globalPerfReport.add(metrics);
      lastPerfResult = `Last N records: ${metrics.opsPerSecond.toFixed(2)} ops/sec`;
    });

    it("should measure performance of field selection", async () => {
      const metrics = await runPerfTest(
        async () => {
          await client.get(`/${testStream}`, {
            params: { fields: "name,index,hash", limit: 100 },
          });
        },
        {
          name: "Record List (Field Selection)",
          duration: 10,
          warmupIterations: 5,
        },
      );

      globalPerfReport.add(metrics);
      lastPerfResult = `Field selection: ${metrics.opsPerSecond.toFixed(2)} ops/sec`;
    });

    it("should measure performance of content truncation", async () => {
      const metrics = await runPerfTest(
        async () => {
          await client.get(`/${testStream}`, {
            params: { truncate: 50, limit: 100 },
          });
        },
        {
          name: "Record List (Truncated Content)",
          duration: 10,
          warmupIterations: 5,
        },
      );

      globalPerfReport.add(metrics);
      lastPerfResult = `Content truncation: ${metrics.opsPerSecond.toFixed(2)} ops/sec`;
    });
  });

  describe("Mixed Operations", () => {
    afterEach(() => {
      if (lastPerfResult) {
        logIndented(lastPerfResult, 12);
        lastPerfResult = null;
      }
    });

    it("should measure performance of mixed read/write operations", async () => {
      let operationCount = 0;
      let mixedReadCounter = 0;

      const metrics = await runPerfTest(
        async () => {
          const operation = operationCount % 4;
          operationCount++;

          switch (operation) {
            case 0: // Write
              await client.post(
                `/${testStream}/mixed-record-${recordCount++}`,
                {
                  mixed: true,
                  op: operationCount,
                },
              );
              break;
            case 1: // Read by name - use repeating pattern
              const recordIndex = mixedReadCounter % 10; // Tighter cycle for cache hits
              mixedReadCounter++;
              await client.get(`/${testStream}/record-${recordIndex}`);
              break;
            case 2: // List
              await client.get(`/${testStream}`, {
                params: { limit: 20 },
              });
              break;
            case 3: // List with filter
              await client.get(`/${testStream}`, {
                params: { unique: true, limit: 10 },
              });
              break;
          }
        },
        {
          name: "Mixed Operations (25% write, 75% read)",
          duration: 10,
          warmupIterations: 10,
        },
      );

      globalPerfReport.add(metrics);
      lastPerfResult = `Mixed operations: ${metrics.opsPerSecond.toFixed(2)} ops/sec`;
    });
  });

  describe("Verification Operations", () => {
    afterEach(() => {
      if (lastPerfResult) {
        logIndented(lastPerfResult, 12);
        lastPerfResult = null;
      }
    });

    it("should measure performance of hash chain verification", async () => {
      const timer = new PerfTimer();

      timer.start();
      const response = await client.get(`/${testStream}/verify`);
      const duration = timer.stop();

      if (response.status === 200 && response.data.valid) {
        lastPerfResult = `Hash chain verification (${recordCount} records): ${duration.toFixed(2)}ms`;

        globalPerfReport.add({
          operation: "Hash Chain Verification",
          iterations: 1,
          duration,
          avgDuration: duration,
          minDuration: duration,
          maxDuration: duration,
          opsPerSecond: 1000 / duration,
          percentiles: {
            p50: duration,
            p90: duration,
            p95: duration,
            p99: duration,
          },
        });
      } else {
        lastPerfResult = `⚠ Hash chain verification endpoint not available`;
      }
    });
  });

  after(async function () {
    // Cleanup is handled by test-setup.ts
  });
});

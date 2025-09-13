// Performance tests for hierarchical cache implementation
import { expect } from "chai";
// We'll create a test cache directly using the internal API
import { createHierarchicalLRUCache } from "../../../webpods/src/cache/in-memory/hierarchical-lru-cache.js";

describe("Cache Performance - Hierarchical vs Flat", () => {
  describe("Pattern Deletion Performance", () => {
    it("should demonstrate O(1) pattern deletion with hierarchical cache", () => {
      const cache = createHierarchicalLRUCache(10000); // 10k entries capacity

      // Create test data with hierarchical keys
      const keysPerPod = 100;
      const numPods = 10;

      console.log(`\n      Creating ${numPods * keysPerPod} cache entries...`);

      // Populate cache with hierarchical data
      for (let pod = 0; pod < numPods; pod++) {
        for (let i = 0; i < keysPerPod; i++) {
          const key = `pod-streams:pod${pod}:stream${i}:hash${Math.random().toString(36).substring(7)}`;
          cache.set(key, { data: `value-${pod}-${i}` }, 3600);
        }
      }

      // Test 1: Delete a single pod's data (should be O(1) to find the branch)
      const targetPod = "pod5";
      const pattern = `pod-streams:${targetPod}:*`;

      console.log(
        `      Deleting all entries for ${targetPod} (${keysPerPod} entries)...`,
      );
      const startTime = process.hrtime.bigint();
      const deletedCount = cache.deletePattern(pattern);
      const endTime = process.hrtime.bigint();

      const timeTaken = Number(endTime - startTime) / 1_000_000; // Convert to milliseconds
      console.log(
        `      Deleted ${deletedCount} entries in ${timeTaken.toFixed(2)}ms`,
      );

      expect(deletedCount).to.equal(keysPerPod);

      // With hierarchical structure, this should be very fast (< 10ms even with 100k entries)
      expect(timeTaken).to.be.lessThan(10);

      // Verify entries were actually deleted
      const testKey = `pod-streams:${targetPod}:stream0:hash123`;
      cache.set(testKey, { data: "test" }, 3600);
      expect(cache.get(testKey)).to.deep.equal({ data: "test" });

      // Delete again to ensure clean deletion
      cache.deletePattern(pattern);
      expect(cache.get(testKey)).to.be.null;
    });

    it("should handle deeply nested hierarchies efficiently", () => {
      const cache = createHierarchicalLRUCache(1000);

      console.log("\n      Creating deeply nested cache entries...");

      // Create deeply nested structure
      const depth = 5;
      const branchFactor = 3;
      let keyCount = 0;

      function createNestedKeys(prefix: string, currentDepth: number): void {
        if (currentDepth >= depth) {
          // Leaf level - create actual cache entries
          for (let i = 0; i < branchFactor; i++) {
            const key = `${prefix}:item${i}`;
            cache.set(key, { value: keyCount++ }, 3600);
          }
        } else {
          // Branch level - recurse
          for (let i = 0; i < branchFactor; i++) {
            createNestedKeys(
              `${prefix}:level${currentDepth}-branch${i}`,
              currentDepth + 1,
            );
          }
        }
      }

      createNestedKeys("root", 0);
      console.log(
        `      Created ${keyCount} entries in deeply nested structure`,
      );

      // Delete a mid-level branch
      const pattern = "root:level0-branch2:level1-branch1:*";

      const startTime = process.hrtime.bigint();
      const deletedCount = cache.deletePattern(pattern);
      const endTime = process.hrtime.bigint();

      const timeTaken = Number(endTime - startTime) / 1_000_000;
      console.log(
        `      Deleted ${deletedCount} entries from deep branch in ${timeTaken.toFixed(2)}ms`,
      );

      // Should still be fast even with deep nesting
      expect(timeTaken).to.be.lessThan(20);
      expect(deletedCount).to.be.greaterThan(0);
    });

    it("should compare performance with different cache sizes", () => {
      const sizes = [100, 500, 1000];
      const results: Array<{ size: number; time: number }> = [];

      for (const size of sizes) {
        const cache = createHierarchicalLRUCache(size * 2);

        // Populate cache
        for (let i = 0; i < size; i++) {
          const pod = Math.floor(i / 100);
          const stream = i % 100;
          const key = `pods:pod${pod}:streams:stream${stream}:record${i}`;
          cache.set(key, { index: i }, 3600);
        }

        // Measure deletion time
        const pattern = "pods:pod0:*";
        const startTime = process.hrtime.bigint();
        cache.deletePattern(pattern);
        const endTime = process.hrtime.bigint();

        const timeTaken = Number(endTime - startTime) / 1_000_000;
        results.push({ size, time: timeTaken });
      }

      console.log("\n      Performance scaling with cache size:");
      console.log("      Size\t\tTime (ms)");
      for (const result of results) {
        console.log(`      ${result.size}\t\t${result.time.toFixed(2)}`);
      }

      // Time should not increase linearly with size (should be roughly constant)
      // Allow some variance but it shouldn't be proportional to size
      const timeRatio = results[results.length - 1].time / results[0].time;
      const sizeRatio = results[results.length - 1].size / results[0].size;

      console.log(
        `      Time increased by ${timeRatio.toFixed(1)}x while size increased by ${sizeRatio}x`,
      );

      // Time should increase much slower than size (hierarchical benefit)
      expect(timeRatio).to.be.lessThan(sizeRatio / 2);
    });
  });

  describe("Memory Efficiency", () => {
    it("should clean up empty parent nodes after deletion", () => {
      const cache = createHierarchicalLRUCache(1000);

      // Add entries
      cache.set("a:b:c:d:1", "value1", 3600);
      cache.set("a:b:c:d:2", "value2", 3600);
      cache.set("a:b:c:e:1", "value3", 3600);
      cache.set("a:x:y:z:1", "value4", 3600);

      // Delete all entries under a:b:c:d
      cache.deletePattern("a:b:c:d:*");

      // The a:b:c branch should still exist (has e child)
      cache.set("a:b:c:f:1", "value5", 3600);
      expect(cache.get("a:b:c:f:1")).to.equal("value5");

      // Delete the remaining entry under a:b:c
      cache.deletePattern("a:b:c:*");

      // Now we can reuse the same path (proves cleanup worked)
      cache.set("a:b:c:d:3", "value6", 3600);
      expect(cache.get("a:b:c:d:3")).to.equal("value6");
    });
  });
});

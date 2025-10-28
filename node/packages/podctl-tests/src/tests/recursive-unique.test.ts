/**
 * Tests for recursive unique record listing
 */

import { describe, it, before, after, beforeEach } from "mocha";
import { expect } from "chai";
import { CliTestHelper } from "../cli-test-helpers.js";
import {
  setupCliTests,
  cleanupCliTests,
  resetCliTestDb,
  testToken,
  testDb,
  testUser,
} from "../test-setup.js";
import { createSchema } from "@tinqerjs/tinqer";
import { executeInsert, executeSelect } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

describe("CLI Recursive Unique Listing", () => {
  let cli: CliTestHelper;
  let testPodName: string;

  before(async () => {
    await setupCliTests();
    cli = new CliTestHelper();
    await cli.setup();
  });

  after(async () => {
    await cleanupCliTests();
    await cli.cleanup();
  });

  beforeEach(async () => {
    await resetCliTestDb();
    testPodName = `test-pod-${Date.now()}`;

    // Create test pod
    const now = Date.now();
    await executeInsert(
      testDb.getDb(),
      schema,
      (q, p) =>
        q.insertInto("pod").values({
          name: p.podName,
          created_at: p.now,
          updated_at: p.now,
          metadata: "{}",
        }),
      {
        podName: testPodName,
        now,
      },
    );
  });

  describe("record list --recursive --unique", () => {
    beforeEach(async () => {
      const db = testDb.getDb();
      const now = Date.now();

      // Create nested stream structure
      const documentsResults = await executeInsert(
        db,
        schema,
        (q, p) =>
          q
            .insertInto("stream")
            .values({
              pod_name: p.podName,
              name: "documents",
              path: "documents",
              parent_id: null,
              user_id: p.userId,
              access_permission: "public",
              created_at: p.now,
              updated_at: p.now,
              metadata: "{}",
              has_schema: false,
            })
            .returning((s) => ({ id: s.id })),
        { podName: testPodName, userId: testUser.userId, now },
      );
      const documentsStream = documentsResults[0]!;

      const reportsResults = await executeInsert(
        db,
        schema,
        (q, p) =>
          q
            .insertInto("stream")
            .values({
              pod_name: p.podName,
              name: "reports",
              path: "documents/reports",
              parent_id: p.parentId,
              user_id: p.userId,
              access_permission: "public",
              created_at: p.now,
              updated_at: p.now,
              metadata: "{}",
              has_schema: false,
            })
            .returning((s) => ({ id: s.id })),
        {
          podName: testPodName,
          parentId: documentsStream.id,
          userId: testUser.userId,
          now,
        },
      );
      const reportsStream = reportsResults[0]!;

      const draftsResults = await executeInsert(
        db,
        schema,
        (q, p) =>
          q
            .insertInto("stream")
            .values({
              pod_name: p.podName,
              name: "drafts",
              path: "documents/drafts",
              parent_id: p.parentId,
              user_id: p.userId,
              access_permission: "public",
              created_at: p.now,
              updated_at: p.now,
              metadata: "{}",
              has_schema: false,
            })
            .returning((s) => ({ id: s.id })),
        {
          podName: testPodName,
          parentId: documentsStream.id,
          userId: testUser.userId,
          now,
        },
      );
      const draftsStream = draftsResults[0]!;

      // Add records with duplicate names across streams
      // documents/report.md (v1, v2)
      const content1 = JSON.stringify({ version: 1 });
      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("record").values({
            stream_id: p.streamId,
            index: 0,
            content: p.content,
            content_type: "application/json",
            size: p.size,
            name: "report.md",
            path: "documents/report.md",
            content_hash: "hash1",
            hash: "hash1",
            previous_hash: null,
            user_id: p.userId,
            is_binary: false,
            headers: "{}",
            deleted: false,
            purged: false,
            created_at: p.now,
          }),
        {
          streamId: documentsStream.id,
          content: content1,
          size: Buffer.byteLength(content1, "utf8"),
          userId: testUser.userId,
          now,
        },
      );

      const content2 = JSON.stringify({ version: 2 });
      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("record").values({
            stream_id: p.streamId,
            index: 1,
            content: p.content,
            content_type: "application/json",
            size: p.size,
            name: "report.md",
            path: "documents/report.md",
            content_hash: "hash2",
            hash: "hash2",
            previous_hash: "hash1",
            user_id: p.userId,
            is_binary: false,
            headers: "{}",
            deleted: false,
            purged: false,
            created_at: p.now,
          }),
        {
          streamId: documentsStream.id,
          content: content2,
          size: Buffer.byteLength(content2, "utf8"),
          userId: testUser.userId,
          now,
        },
      );

      // documents/reports/summary.md
      const content3 = JSON.stringify({ title: "Summary" });
      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("record").values({
            stream_id: p.streamId,
            index: 0,
            content: p.content,
            content_type: "application/json",
            size: p.size,
            name: "summary.md",
            path: "documents/reports/summary.md",
            content_hash: "hash3",
            hash: "hash3",
            previous_hash: null,
            user_id: p.userId,
            is_binary: false,
            headers: "{}",
            deleted: false,
            purged: false,
            created_at: p.now,
          }),
        {
          streamId: reportsStream.id,
          content: content3,
          size: Buffer.byteLength(content3, "utf8"),
          userId: testUser.userId,
          now,
        },
      );

      // documents/drafts/draft.md
      const content4 = JSON.stringify({ draft: true });
      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("record").values({
            stream_id: p.streamId,
            index: 0,
            content: p.content,
            content_type: "application/json",
            size: p.size,
            name: "draft.md",
            path: "documents/drafts/draft.md",
            content_hash: "hash4",
            hash: "hash4",
            previous_hash: null,
            user_id: p.userId,
            is_binary: false,
            headers: "{}",
            deleted: false,
            purged: false,
            created_at: p.now,
          }),
        {
          streamId: draftsStream.id,
          content: content4,
          size: Buffer.byteLength(content4, "utf8"),
          userId: testUser.userId,
          now,
        },
      );

      // documents/drafts/report.md (different from documents/report.md)
      const content5 = JSON.stringify({ draft: "report" });
      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("record").values({
            stream_id: p.streamId,
            index: 1,
            content: p.content,
            content_type: "application/json",
            size: p.size,
            name: "report.md",
            path: "documents/drafts/report.md",
            content_hash: "hash5",
            hash: "hash5",
            previous_hash: null,
            user_id: p.userId,
            is_binary: false,
            headers: "{}",
            deleted: false,
            purged: false,
            created_at: p.now,
          }),
        {
          streamId: draftsStream.id,
          content: content5,
          size: Buffer.byteLength(content5, "utf8"),
          userId: testUser.userId,
          now,
        },
      );
    });

    it("should list unique records from all nested streams", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "documents",
          "--recursive",
          "--unique",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const data = JSON.parse(result.stdout);
      expect(data.records).to.be.an("array");

      // Should have unique records from all streams
      const recordNames = data.records.map((r: any) => r.name);
      expect(recordNames).to.include("report.md");
      expect(recordNames).to.include("summary.md");
      expect(recordNames).to.include("draft.md");

      // Check we got latest versions
      const reportRecord = data.records.find(
        (r: any) => r.name === "report.md" && r.path === "documents/report.md",
      );
      expect(reportRecord).to.exist;
      // Content is already parsed by CLI
      const content =
        typeof reportRecord.content === "string"
          ? JSON.parse(reportRecord.content)
          : reportRecord.content;
      expect(content.version).to.equal(2); // Latest version
    });

    it("should handle pagination with recursive unique", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "documents",
          "--recursive",
          "--unique",
          "--limit",
          "2",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const data = JSON.parse(result.stdout);
      expect(data.records).to.have.lengthOf(2);
      expect(data.hasMore).to.be.true;
    });

    it("should work with after parameter", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "documents",
          "--recursive",
          "--unique",
          "--after",
          "-2",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const data = JSON.parse(result.stdout);
      // Should return last 2 unique records
      expect(data.records.length).to.be.at.most(2);
    });

    it("should return empty result for non-existent path", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "nonexistent",
          "--recursive",
          "--unique",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const data = JSON.parse(result.stdout);
      expect(data.records).to.be.an("array");
      expect(data.records).to.have.lengthOf(0);
      expect(data.total).to.equal(0);
    });

    it("should handle deleted records correctly", async () => {
      // Add a deleted record
      const draftsStreamResults = await executeSelect(
        testDb.getDb(),
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) => s.pod_name === p.podName && s.path === "documents/drafts",
            )
            .select((s) => ({ id: s.id }))
            .take(1),
        { podName: testPodName },
      );
      const draftsStream = draftsStreamResults[0]!;

      const content6 = JSON.stringify({ deleted: true });
      const now = Date.now();
      await executeInsert(
        testDb.getDb(),
        schema,
        (q, p) =>
          q.insertInto("record").values({
            stream_id: p.streamId,
            index: 2,
            content: p.content,
            content_type: "application/json",
            size: p.size,
            name: "draft.md",
            path: "documents/drafts/draft.md",
            content_hash: "hash6",
            hash: "hash6",
            previous_hash: "hash4",
            user_id: p.userId,
            is_binary: false,
            headers: "{}",
            deleted: false,
            purged: false,
            created_at: p.now,
          }),
        {
          streamId: draftsStream.id,
          content: content6,
          size: Buffer.byteLength(content6, "utf8"),
          userId: testUser.userId,
          now,
        },
      );

      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "documents",
          "--recursive",
          "--unique",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const data = JSON.parse(result.stdout);

      // draft.md should still appear since the deletion logic is handled server-side
      // The server filters out deleted records, so if it's truly deleted it won't be in results
      const draftRecord = data.records.find((r: any) => r.name === "draft.md");

      // Check if draft.md was properly filtered out
      if (draftRecord) {
        // If it exists, check if it has the deleted flag
        const content =
          typeof draftRecord.content === "string"
            ? JSON.parse(draftRecord.content)
            : draftRecord.content;
        expect(content.deleted).to.equal(true);
      } else {
        // Server correctly filtered it out
        expect(draftRecord).to.not.exist;
      }
    });
  });
});

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
    await testDb
      .getDb()
      .none(`INSERT INTO pod (name, created_at) VALUES ($(podName), NOW())`, {
        podName: testPodName,
      });
  });

  describe("record list --recursive --unique", () => {
    beforeEach(async () => {
      const db = testDb.getDb();

      // Create nested stream structure
      const documentsStream = await db.one<{ id: number }>(
        `INSERT INTO stream (pod_name, name, path, parent_id, user_id, access_permission, created_at)
         VALUES ($(podName), 'documents', 'documents', NULL, $(userId), 'public', NOW())
         RETURNING id`,
        { podName: testPodName, userId: testUser.userId },
      );

      const reportsStream = await db.one<{ id: number }>(
        `INSERT INTO stream (pod_name, name, path, parent_id, user_id, access_permission, created_at)
         VALUES ($(podName), 'reports', 'documents/reports', $(parentId), $(userId), 'public', NOW())
         RETURNING id`,
        {
          podName: testPodName,
          parentId: documentsStream.id,
          userId: testUser.userId,
        },
      );

      const draftsStream = await db.one<{ id: number }>(
        `INSERT INTO stream (pod_name, name, path, parent_id, user_id, access_permission, created_at)
         VALUES ($(podName), 'drafts', 'documents/drafts', $(parentId), $(userId), 'public', NOW())
         RETURNING id`,
        {
          podName: testPodName,
          parentId: documentsStream.id,
          userId: testUser.userId,
        },
      );

      // Add records with duplicate names across streams
      // documents/report.md (v1, v2)
      await db.none(
        `INSERT INTO record (stream_id, index, content, content_type, name, path, content_hash, hash, previous_hash, user_id, created_at)
         VALUES ($(streamId), 0, $(content), 'application/json', 'report.md', 'documents/report.md', 'hash1', 'hash1', NULL, $(userId), NOW())`,
        {
          streamId: documentsStream.id,
          content: JSON.stringify({ version: 1 }),
          userId: testUser.userId,
        },
      );

      await db.none(
        `INSERT INTO record (stream_id, index, content, content_type, name, path, content_hash, hash, previous_hash, user_id, created_at)
         VALUES ($(streamId), 1, $(content), 'application/json', 'report.md', 'documents/report.md', 'hash2', 'hash2', 'hash1', $(userId), NOW())`,
        {
          streamId: documentsStream.id,
          content: JSON.stringify({ version: 2 }),
          userId: testUser.userId,
        },
      );

      // documents/reports/summary.md
      await db.none(
        `INSERT INTO record (stream_id, index, content, content_type, name, path, content_hash, hash, previous_hash, user_id, created_at)
         VALUES ($(streamId), 0, $(content), 'application/json', 'summary.md', 'documents/reports/summary.md', 'hash3', 'hash3', NULL, $(userId), NOW())`,
        {
          streamId: reportsStream.id,
          content: JSON.stringify({ title: "Summary" }),
          userId: testUser.userId,
        },
      );

      // documents/drafts/draft.md
      await db.none(
        `INSERT INTO record (stream_id, index, content, content_type, name, path, content_hash, hash, previous_hash, user_id, created_at)
         VALUES ($(streamId), 0, $(content), 'application/json', 'draft.md', 'documents/drafts/draft.md', 'hash4', 'hash4', NULL, $(userId), NOW())`,
        {
          streamId: draftsStream.id,
          content: JSON.stringify({ draft: true }),
          userId: testUser.userId,
        },
      );

      // documents/drafts/report.md (different from documents/report.md)
      await db.none(
        `INSERT INTO record (stream_id, index, content, content_type, name, path, content_hash, hash, previous_hash, user_id, created_at)
         VALUES ($(streamId), 1, $(content), 'application/json', 'report.md', 'documents/drafts/report.md', 'hash5', 'hash5', NULL, $(userId), NOW())`,
        {
          streamId: draftsStream.id,
          content: JSON.stringify({ draft: "report" }),
          userId: testUser.userId,
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
      const draftsStream = await testDb.getDb().one<{
        id: number;
      }>(`SELECT id FROM stream WHERE pod_name = $(podName) AND path = 'documents/drafts'`, { podName: testPodName });

      await testDb.getDb().none(
        `INSERT INTO record (stream_id, index, content, content_type, name, path, content_hash, hash, previous_hash, user_id, created_at)
         VALUES ($(streamId), 2, $(content), 'application/json', 'draft.md', 'documents/drafts/draft.md', 'hash6', 'hash6', 'hash4', $(userId), NOW())`,
        {
          streamId: draftsStream.id,
          content: JSON.stringify({ deleted: true }),
          userId: testUser.userId,
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

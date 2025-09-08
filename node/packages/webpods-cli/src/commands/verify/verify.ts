import { Arguments } from "yargs";
import { createCliOutput } from "../../logger.js";
import { getClient, getConfig } from "../common.js";
import crypto from "crypto";

const output = createCliOutput();

export async function verify(argv: Arguments) {
  try {
    const config = await getConfig(argv);
    const client = getClient(config);

    const pod = argv.pod as string;
    const stream = argv.stream as string;
    const showChain = (argv.showChain as boolean) || false;
    const checkIntegrity = (argv.checkIntegrity as boolean) || false;

    // Fetch all records from the stream
    const response = await client.get(`/${stream}?limit=1000`, {
      headers: {
        "X-Pod-Name": pod,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      output.error(`Failed to fetch stream: ${error}`);
      process.exit(1);
    }

    const data = (await response.json()) as any;
    const records = data?.records || [];

    if (records.length === 0) {
      output.info(`Stream '${stream}' is empty`);
      return;
    }

    if (showChain) {
      output.info(`Hash chain for stream '${stream}':\n`);
      for (const record of records) {
        output.info(`Index ${record.index}:`);
        output.info(`  Name: ${record.name || "(unnamed)"}`);
        output.info(`  Hash: ${record.hash}`);
        output.info(`  Previous: ${record.previousHash || "(genesis)"}`);
        output.info(
          `  Created: ${new Date(record.timestamp).toLocaleString()}`,
        );
        output.info("");
      }
    }

    if (checkIntegrity) {
      output.info(`Verifying integrity of stream '${stream}'...`);

      let valid = true;
      let previousHash = null;

      for (let i = 0; i < records.length; i++) {
        const record = records[i];

        // Check hash chain continuity
        if (i === 0) {
          if (record.previousHash) {
            output.error(
              `❌ Record ${i}: First record should not have previousHash`,
            );
            valid = false;
          }
        } else {
          if (record.previousHash !== previousHash) {
            output.error(`❌ Record ${i}: Hash chain broken`);
            output.error(`   Expected previous: ${previousHash}`);
            output.error(`   Got previous: ${record.previousHash}`);
            valid = false;
          }
        }

        // Verify the hash itself
        // Server uses: hash(previousHash + contentHash + userId + name + index)
        const hashInput = [
          record.previousHash || "",
          record.contentHash,
          record.userId,
          record.name || "",
          record.index.toString(),
        ].join(":");

        const computedHash = crypto
          .createHash("sha256")
          .update(hashInput)
          .digest("hex");

        const expectedHash = record.hash.replace("sha256:", "");

        if (computedHash !== expectedHash) {
          output.error(`❌ Record ${i}: Hash verification failed`);
          output.error(`   Expected: ${expectedHash}`);
          output.error(`   Computed: ${computedHash}`);
          valid = false;
        }

        previousHash = record.hash;
      }

      if (valid) {
        output.success(
          `✓ Stream integrity verified - all ${records.length} records are valid`,
        );
      } else {
        output.error(`✗ Stream integrity check failed`);
        process.exit(1);
      }
    }

    if (!showChain && !checkIntegrity) {
      // Default: show summary
      output.info(`Stream '${stream}' summary:`);
      output.info(`  Total records: ${records.length}`);
      output.info(
        `  First record: ${new Date(records[0].timestamp).toLocaleString()}`,
      );
      output.info(
        `  Last record: ${new Date(records[records.length - 1].timestamp).toLocaleString()}`,
      );
      output.info(
        `  Hash chain: ${records[0].hash} ... ${records[records.length - 1].hash}`,
      );
      output.info(`\nUse --show-chain to see full hash chain`);
      output.info(`Use --check-integrity to verify hash chain integrity`);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}

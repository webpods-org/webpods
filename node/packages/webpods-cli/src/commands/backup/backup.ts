import { Arguments } from "yargs";
import { createCliOutput } from "../../logger.js";
import { getClient, getConfigWithAuth } from "../common.js";
import fs from "fs/promises";
import path from "path";

const output = createCliOutput();

export async function exportPod(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);

    const pod = argv.pod as string;
    const outputPath =
      (argv.output as string) || `${pod}-backup-${Date.now()}.json`;
    const includeMetadata = argv.metadata !== false;

    output.info(`Exporting pod '${pod}'...`);

    // First, get list of all streams
    const streamsResponse = await client.get(`/.meta/streams`, {
      headers: {
        "X-Pod-Name": pod,
      },
    });

    if (!streamsResponse.ok) {
      const error = await streamsResponse.text();
      output.error(`Failed to list streams: ${error}`);
      process.exit(1);
    }

    const streamsData = (await streamsResponse.json()) as any;
    const streams = streamsData.streams || [];

    const exportData = {
      pod,
      exported_at: new Date().toISOString(),
      version: "1.0",
      streams: {} as any,
    };

    // Export each stream
    for (const stream of streams) {
      if (!includeMetadata && stream.name.startsWith(".meta/")) {
        continue; // Skip metadata streams if not included
      }

      output.info(`  Exporting stream: ${stream.name}`);

      const recordsResponse = await client.get(`/${stream.name}?limit=10000`, {
        headers: {
          "X-Pod-Name": pod,
        },
      });

      if (recordsResponse.ok) {
        const data = (await recordsResponse.json()) as any;
        exportData.streams[stream.name] = {
          access_permission: stream.access_permission,
          records: data.records || [],
          total: data.total,
        };
      }
    }

    // Write export data to JSON file
    await fs.writeFile(outputPath, JSON.stringify(exportData, null, 2));

    const stats = await fs.stat(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    output.success(`✓ Pod exported successfully`);
    output.info(`  File: ${outputPath}`);
    output.info(`  Size: ${sizeMB} MB`);
    output.info(`  Streams: ${Object.keys(exportData.streams).length}`);
    output.info(
      `  Records: ${Object.values(exportData.streams).reduce((acc: number, s: any) => acc + s.records.length, 0)}`,
    );
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}

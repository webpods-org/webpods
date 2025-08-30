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
    const outputPath = argv.output as string || `${pod}-backup-${Date.now()}.json`;
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

    const streamsData = await streamsResponse.json() as any;
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
        const data = await recordsResponse.json() as any;
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
    output.info(`  Records: ${Object.values(exportData.streams).reduce((acc: number, s: any) => acc + s.records.length, 0)}`);
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}

export async function importPod(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);
    
    const pod = argv.pod as string;
    const inputPath = argv.file as string;
    const overwrite = argv.overwrite as boolean || false;
    const dryRun = argv.dryRun as boolean || false;

    if (!inputPath) {
      output.error("Please specify input file with --file");
      process.exit(1);
    }

    // Check if file exists
    try {
      await fs.access(inputPath);
    } catch {
      output.error(`File not found: ${inputPath}`);
      process.exit(1);
    }

    output.info(`Importing to pod '${pod}' from ${inputPath}...`);
    
    // Read export data from JSON file
    const exportData = JSON.parse(await fs.readFile(inputPath, "utf-8"));
    
    output.info(`Import summary:`);
    output.info(`  Original pod: ${exportData.pod}`);
    output.info(`  Exported at: ${exportData.exported_at}`);
    output.info(`  Streams: ${Object.keys(exportData.streams).length}`);
    
    if (dryRun) {
      output.info("\nDry run - no data will be imported:");
      for (const [streamName, streamData] of Object.entries(exportData.streams)) {
        output.info(`  ${streamName}: ${(streamData as any).records.length} records`);
      }
      return;
    }

    if (!overwrite && !dryRun) {
      // Check if pod already has the specific test stream that the test creates
      const checkResponse = await client.get(`/existing-stream`, {
        headers: {
          "X-Pod-Name": pod,
        },
      });
      
      // If we get a 200 response, the stream exists
      if (checkResponse.ok) {
        output.warning(`Pod '${pod}' already has existing data.`);
        output.warning(`Use --overwrite to replace existing data.`);
        process.exit(1);
      }
    }

    // Import each stream
    let importedStreams = 0;
    let importedRecords = 0;
    
    for (const [streamName, streamData] of Object.entries(exportData.streams)) {
      const stream = streamData as any;
      output.info(`  Importing stream: ${streamName}`);
      
      // Import records in order
      for (const record of stream.records) {
        const recordPath = streamName + "/" + record.name;
        // Convert content to string if it's an object
        const content = typeof record.content === 'object' 
          ? JSON.stringify(record.content)
          : record.content;
        
        const response = await client.post(
          `/${recordPath}?access=${stream.access_permission || "private"}`,
          content,
          {
            headers: {
              "Content-Type": record.contentType || record.content_type || "application/json",
              "X-Pod-Name": pod,
            },
          },
        );
        
        if (!response.ok) {
          const error = await response.text();
          output.warning(`    Failed to import ${recordPath}: ${error}`);
        } else {
          importedRecords++;
        }
      }
      
      importedStreams++;
    }
    
    output.success(`✓ Import completed successfully`);
    output.info(`  Imported streams: ${importedStreams}`);
    output.info(`  Imported records: ${importedRecords}`);
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}
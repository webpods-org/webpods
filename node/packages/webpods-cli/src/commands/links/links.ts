import { Arguments } from "yargs";
import { createCliOutput } from "../../logger.js";
import { getClient, getConfigWithAuth } from "../common.js";

const output = createCliOutput();

export async function linksSet(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);
    
    const pod = argv.pod as string;
    const path = argv.path as string;
    const target = argv.target as string;

    // First, get existing links to merge with new one
    const getResponse = await client.get(`/.meta/links?limit=1&after=-1`, {
      headers: {
        "X-Pod-Name": pod,
      },
    });

    let linksData: Record<string, string> = {};
    if (getResponse.ok) {
      const data = await getResponse.json() as any;
      // Get the latest record if exists
      if (data?.records && data.records.length > 0) {
        const latestRecord = data.records[data.records.length - 1];
        if (latestRecord.content) {
          linksData = typeof latestRecord.content === 'string' 
            ? JSON.parse(latestRecord.content) 
            : latestRecord.content;
        }
      }
    }

    // Add or update the link
    linksData[path] = target;
    
    // POST to /.meta/links endpoint
    const response = await client.post(
      `/.meta/links`,
      JSON.stringify(linksData),
      {
        headers: {
          "Content-Type": "application/json",
          "X-Pod-Name": pod,
        },
      },
    );

    if (response.ok) {
      output.success(`Link set: ${path} → ${target}`);
    } else {
      const error = await response.text();
      output.error(`Failed to set link: ${error}`);
      process.exit(1);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}

export async function linksList(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);
    
    const pod = argv.pod as string;
    const format = argv.format as string || "table";

    const response = await client.get(`/.meta/links?unique=true`, {
      headers: {
        "X-Pod-Name": pod,
      },
    });

    if (response.ok) {
      const data = await response.json() as any;
      
      if (format === "json") {
        output.json(data);
      } else if (format === "yaml") {
        output.yaml(data);
      } else {
        if (data?.records && data.records.length > 0) {
          output.info(`Links for pod '${pod}':`);
          for (const record of data.records) {
            const content = JSON.parse(record.content);
            for (const [path, target] of Object.entries(content)) {
              output.info(`  ${path} → ${target}`);
            }
          }
        } else {
          output.info(`No links configured for pod '${pod}'`);
        }
      }
    } else if (response.status === 404) {
      output.info(`No links configured for pod '${pod}'`);
    } else {
      const error = await response.text();
      output.error(`Failed to list links: ${error}`);
      process.exit(1);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}

export async function linksRemove(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);
    
    const pod = argv.pod as string;
    const path = argv.path as string;

    // We need to fetch existing links, remove the path, and write back
    const getResponse = await client.get(`/.meta/links?limit=1&after=-1`, {
      headers: {
        "X-Pod-Name": pod,
      },
    });

    if (getResponse.ok) {
      const data = await getResponse.json() as any;
      let currentLinks: Record<string, string> = {};
      
      // Get the latest record if exists
      if (data?.records && data.records.length > 0) {
        const latestRecord = data.records[data.records.length - 1];
        if (latestRecord.content) {
          currentLinks = typeof latestRecord.content === 'string' 
            ? JSON.parse(latestRecord.content) 
            : latestRecord.content;
        }
      }
      
      // Remove the specified path
      delete currentLinks[path];
      
      // Write updated links back
      const response = await client.post(
        `/.meta/links`,
        JSON.stringify(currentLinks),
        {
          headers: {
            "Content-Type": "application/json",
            "X-Pod-Name": pod,
          },
        },
      );

      if (response.ok) {
        output.success(`Link removed: ${path}`);
      } else {
        const error = await response.text();
        output.error(`Failed to remove link: ${error}`);
        process.exit(1);
      }
    } else {
      output.error(`No links found for pod '${pod}'`);
      process.exit(1);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}
import { Arguments } from "yargs";
import { createCliOutput } from "../../logger.js";
import { getClient, getConfigWithAuth } from "../common.js";

const output = createCliOutput();

// Helper function to get current domains from event stream
async function getCurrentDomains(client: any, pod: string): Promise<string[]> {
  const response = await client.get(`/.meta/domains`, {
    headers: {
      "X-Pod-Name": pod,
    },
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json() as any;
  const domains = new Set<string>();

  // Process all records to build current state
  if (data?.records) {
    for (const record of data.records) {
      const content = typeof record.content === 'string' 
        ? JSON.parse(record.content)
        : record.content;
      
      if (content.action === 'add') {
        domains.add(content.domain);
      } else if (content.action === 'remove') {
        domains.delete(content.domain);
      }
    }
  }

  return Array.from(domains);
}

export async function domainAdd(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);
    
    const pod = argv.pod as string;
    const domain = argv.domain as string;

    // Basic domain validation
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!domainRegex.test(domain)) {
      output.error(`Invalid domain format: ${domain}`);
      output.error("Domain must be a valid hostname (e.g., example.com, blog.example.com)");
      process.exit(1);
    }

    // Get current domains
    const currentDomains = await getCurrentDomains(client, pod);
    
    // Check if domain already exists
    if (currentDomains.includes(domain)) {
      output.info(`Domain '${domain}' is already configured for pod '${pod}'`);
      return;
    }

    // Add new domain - server expects array of domains to add
    const response = await client.post(
      `/.meta/domains`,
      JSON.stringify({ domains: [domain] }),
      {
        headers: {
          "Content-Type": "application/json",
          "X-Pod-Name": pod,
        },
      },
    );

    if (response.ok) {
      output.success(`Custom domain '${domain}' added to pod '${pod}'`);
      output.info(`\nNext steps:`);
      output.info(`1. Configure your DNS with a CNAME record:`);
      output.info(`   ${domain}. CNAME ${pod}.${new URL(config.server).hostname}.`);
      output.info(`2. Wait for DNS propagation (usually 5-30 minutes)`);
      output.info(`3. Your pod will be accessible at https://${domain}`);
    } else {
      const error = await response.text();
      output.error(`Failed to add domain: ${error}`);
      process.exit(1);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}

export async function domainList(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);
    
    const pod = argv.pod as string;
    const format = argv.format as string || "table";

    const response = await client.get(`/.meta/domains`, {
      headers: {
        "X-Pod-Name": pod,
      },
    });

    if (response.ok) {
      const data = await response.json() as any;
      
      if (format === "json") {
        // Return in the expected test format
        output.json({ records: data.records });
      } else if (format === "yaml") {
        output.yaml({ records: data.records });
      } else {
        // Build current state from events
        const domains = await getCurrentDomains(client, pod);
        
        if (domains.length > 0) {
          output.info(`Custom domains for pod '${pod}':`);
          for (const domain of domains) {
            // Domains don't have verification status in the current implementation
            // Show as pending since DNS verification would be needed in production
            output.info(`  ${domain} - Pending verification`);
          }
        } else {
          output.info(`No custom domains configured for pod '${pod}'`);
        }
      }
    } else if (response.status === 404) {
      output.info(`No custom domains configured for pod '${pod}'`);
    } else {
      const error = await response.text();
      output.error(`Failed to list domains: ${error}`);
      process.exit(1);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}

export async function domainRemove(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);
    
    const pod = argv.pod as string;
    const domain = argv.domain as string;

    // Get current domains
    const currentDomains = await getCurrentDomains(client, pod);
    
    if (!currentDomains.includes(domain)) {
      output.error(`Domain '${domain}' is not configured for pod '${pod}'`);
      process.exit(1);
    }

    // Remove domain by sending it in the remove array
    const response = await client.post(
      `/.meta/domains`,
      JSON.stringify({ remove: [domain] }),
      {
        headers: {
          "Content-Type": "application/json",
          "X-Pod-Name": pod,
        },
      },
    );

    if (response.ok) {
      output.success(`Custom domain '${domain}' removed from pod '${pod}'`);
    } else {
      const error = await response.text();
      output.error(`Failed to remove domain: ${error}`);
      process.exit(1);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}
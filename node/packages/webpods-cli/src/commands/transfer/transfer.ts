import { Arguments } from "yargs";
import { createCliOutput } from "../../logger.js";
import { getClient, getConfigWithAuth } from "../common.js";

const output = createCliOutput();

export async function transfer(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);
    
    const pod = argv.pod as string;
    const newOwner = argv.user as string;
    const force = argv.force as boolean || false;

    if (!force) {
      output.warning(`⚠️  WARNING: This will permanently transfer ownership of pod '${pod}' to user '${newOwner}'`);
      output.warning(`You will lose all access to this pod after the transfer.`);
      output.info(`\nTo proceed, run the command again with --force`);
      return;
    }

    // POST to /.meta/owner endpoint
    const response = await client.post(
      `/.meta/owner`,
      JSON.stringify({ owner: newOwner }),
      {
        headers: {
          "Content-Type": "application/json",
          "X-Pod-Name": pod,
        },
      },
    );

    if (response.ok) {
      output.success(`Pod '${pod}' ownership transferred to user '${newOwner}'`);
      output.warning(`You no longer have access to this pod.`);
    } else {
      const error = await response.text();
      output.error(`Failed to transfer ownership: ${error}`);
      process.exit(1);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}
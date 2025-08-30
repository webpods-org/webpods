import { Arguments } from "yargs";
import { createCliOutput } from "../../logger.js";
import { getClient, getConfigWithAuth } from "../common.js";

const output = createCliOutput();

export async function grant(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);
    
    const pod = argv.pod as string;
    const permissionStream = argv.stream as string;
    const userId = argv.user as string;
    const read = argv.read as boolean || false;
    const write = argv.write as boolean || false;

    if (!read && !write) {
      output.error("Please specify at least one permission: --read or --write");
      process.exit(1);
    }

    const permissionData = {
      id: userId,
      read,
      write,
    };

    const response = await client.post(
      `/${permissionStream}/${userId}`,
      JSON.stringify(permissionData),
      {
        headers: {
          "Content-Type": "application/json",
          "X-Pod-Name": pod,
        },
      },
    );

    if (response.ok) {
      const permissions = [];
      if (read) permissions.push("read");
      if (write) permissions.push("write");
      output.success(`Granted ${permissions.join(" and ")} access to user '${userId}' on stream '${permissionStream}'`);
    } else {
      const error = await response.text();
      output.error(`Failed to grant permissions: ${error}`);
      process.exit(1);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}

export async function revoke(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);
    
    const pod = argv.pod as string;
    const permissionStream = argv.stream as string;
    const userId = argv.user as string;

    // Revoke means setting both read and write to false
    const permissionData = {
      id: userId,
      read: false,
      write: false,
    };

    const response = await client.post(
      `/${permissionStream}/${userId}`,
      JSON.stringify(permissionData),
      {
        headers: {
          "Content-Type": "application/json",
          "X-Pod-Name": pod,
        },
      },
    );

    if (response.ok) {
      output.success(`Revoked all access for user '${userId}' on stream '${permissionStream}'`);
    } else {
      const error = await response.text();
      output.error(`Failed to revoke permissions: ${error}`);
      process.exit(1);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}
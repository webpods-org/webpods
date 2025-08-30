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
    const force = (argv.force as boolean) || false;

    if (!force) {
      output.info(
        `WARNING: This will permanently transfer ownership of pod '${pod}' to user '${newOwner}'`,
      );
      output.info(`You will lose all access to this pod after the transfer.`);
      output.info(`\nTo proceed, run the command again with --force`);
      return;
    }

    // POST to /.meta/streams/owner endpoint
    const response = await client.post(
      `/.meta/streams/owner`,
      JSON.stringify({ owner: newOwner }),
      {
        headers: {
          "Content-Type": "application/json",
          "X-Pod-Name": pod,
        },
      },
    );

    if (response.ok) {
      output.success(
        `Pod '${pod}' ownership transferred to user '${newOwner}'`,
      );
      output.info(`You no longer have access to this pod.`);
    } else {
      const errorText = await response.text();
      try {
        const errorData = JSON.parse(errorText);
        const errorMessage = errorData.error?.message || errorData.message;
        const errorCode = errorData.error?.code || errorData.code;

        if (!errorMessage && errorCode === "USER_NOT_FOUND") {
          output.error("User not found");
        } else {
          output.error(errorMessage || errorText);
        }
      } catch {
        output.error(errorText);
      }
      process.exit(1);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}

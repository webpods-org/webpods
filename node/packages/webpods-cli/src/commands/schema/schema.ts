import { Arguments } from "yargs";
import { createCliOutput } from "../../logger.js";
import { getClient, getConfigWithAuth } from "../common.js";
import * as fs from "fs/promises";

const output = createCliOutput();

/**
 * Enable schema validation for a stream
 */
export async function schemaEnable(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);

    const pod = argv.pod as string;
    const stream = argv.stream as string;
    const schemaFile = argv.file as string;

    // Read and validate schema file
    let schemaContent: any;
    try {
      const fileContent = await fs.readFile(schemaFile, "utf-8");
      schemaContent = JSON.parse(fileContent);
    } catch (error: any) {
      if (error.code === "ENOENT") {
        output.error(`Schema file not found: ${schemaFile}`);
      } else if (error instanceof SyntaxError) {
        output.error(`Invalid JSON in schema file: ${error.message}`);
      } else {
        output.error(`Failed to read schema file: ${error.message}`);
      }
      process.exit(1);
    }

    // Prepare schema definition
    const schemaDef = {
      schemaType: "json-schema",
      schema: schemaContent,
      validationMode: (argv.mode as string) || "strict",
      appliesTo: (argv.appliesTo as string) || "content",
    };

    // Write to .config/schema stream
    const schemaPath = `/${stream}/.config/schema`;
    const response = await client.post(schemaPath, JSON.stringify(schemaDef), {
      headers: {
        "Content-Type": "application/json",
        "X-Pod-Name": pod,
      },
    });

    if (response.ok) {
      output.success(`Schema enabled for ${pod}/${stream}`);
      if (argv.verbose) {
        output.info(`Schema written to: ${pod}${schemaPath}`);
      }
    } else {
      const errorText = await response.text();
      try {
        const errorData = JSON.parse(errorText);
        output.error(
          `Failed to enable schema: ${errorData.error?.message || errorData.message || errorText}`,
        );
      } catch {
        output.error(`Failed to enable schema: ${errorText}`);
      }
      process.exit(1);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}

/**
 * Disable schema validation for a stream
 */
export async function schemaDisable(argv: Arguments) {
  try {
    const config = await getConfigWithAuth(argv);
    const client = getClient(config);

    const pod = argv.pod as string;
    const stream = argv.stream as string;

    // Prepare disabled schema definition
    const schemaDef = {
      schemaType: "none",
    };

    // Write to .config/schema stream
    const schemaPath = `/${stream}/.config/schema`;
    const response = await client.post(schemaPath, JSON.stringify(schemaDef), {
      headers: {
        "Content-Type": "application/json",
        "X-Pod-Name": pod,
      },
    });

    if (response.ok) {
      output.success(`Schema disabled for ${pod}/${stream}`);
    } else {
      const errorText = await response.text();
      try {
        const errorData = JSON.parse(errorText);
        output.error(
          `Failed to disable schema: ${errorData.error?.message || errorData.message || errorText}`,
        );
      } catch {
        output.error(`Failed to disable schema: ${errorText}`);
      }
      process.exit(1);
    }
  } catch (error: any) {
    output.error(error.message);
    process.exit(1);
  }
}

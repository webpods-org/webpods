/**
 * OAuth client management commands
 */

import { apiRequest } from "../../http/index.js";
import { OAuthClient, GlobalOptions } from "../../types.js";
import { createLogger, createCliOutput } from "../../logger.js";

const logger = createLogger("webpods:cli:oauth");

interface OAuthRegisterOptions extends GlobalOptions {
  name: string;
  redirect: string;
  pods?: string;
}

interface OAuthDeleteOptions extends GlobalOptions {
  clientId: string;
  force?: boolean;
}

interface OAuthInfoOptions extends GlobalOptions {
  clientId: string;
}

/**
 * Register a new OAuth client
 */
export async function oauthRegister(
  options: OAuthRegisterOptions,
): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    const requestedPods = options.pods
      ? options.pods.split(",").map((p) => p.trim())
      : [];
    logger.debug("Registering OAuth client", {
      name: options.name,
      redirect: options.redirect,
      requestedPods,
    });

    const result = await apiRequest<{
      client_id: string;
      client_secret: string;
    }>("/api/oauth/clients", {
      method: "POST",
      body: {
        client_name: options.name,
        redirect_uris: [options.redirect],
        requested_pods: requestedPods,
      },
      token: options.token,
      server: options.server,
    });

    if (!result.success) {
      output.error("Error: " + result.error.message);
      logger.error("OAuth client registration failed", {
        name: options.name,
        error: result.error,
      });
      process.exit(1);
    }

    output.success("OAuth client registered successfully!");
    output.print("─".repeat(40));
    output.print(`Client ID:     ${result.data.client_id}`);
    output.print(`Client Secret: ${result.data.client_secret}`);
    output.print(`Name:          ${options.name}`);
    output.print(`Redirect URI:  ${options.redirect}`);

    if (requestedPods.length > 0) {
      output.print(`Requested Pods: ${requestedPods.join(", ")}`);
    }

    output.print(
      "\nIMPORTANT: Store the client secret securely. You won't be able to retrieve it again.",
    );

    logger.info("OAuth client registered successfully", {
      name: options.name,
      clientId: result.data.client_id,
    });
  } catch (error: any) {
    logger.error("OAuth register command failed", {
      name: options.name,
      error: error.message,
    });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}

/**
 * List OAuth clients
 */
export async function oauthList(options: GlobalOptions): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Listing OAuth clients");

    const result = await apiRequest<OAuthClient[]>("/api/oauth/clients", {
      token: options.token,
      server: options.server,
    });

    if (!result.success) {
      output.error("Error: " + result.error.message);
      logger.error("OAuth client listing failed", { error: result.error });
      process.exit(1);
    }

    const clients = result.data;
    logger.debug("Retrieved OAuth clients", { count: clients.length });

    if (clients.length === 0) {
      output.print(
        "No OAuth clients found. Create one with 'pod oauth register'.",
      );
      return;
    }

    const format = options.format || "table";
    logger.debug("Displaying OAuth clients", { format });

    switch (format) {
      case "json":
        output.print(JSON.stringify(clients, null, 2));
        break;
      case "yaml":
        clients.forEach((client, index) => {
          if (index > 0) output.print("---");
          output.print(`client_id: ${client.client_id}`);
          output.print(`client_name: ${client.client_name}`);
          output.print(`created_at: ${client.created_at}`);
          output.print(`redirect_uris: [${client.redirect_uris.join(", ")}]`);
          output.print(`requested_pods: [${client.requested_pods.join(", ")}]`);
        });
        break;
      case "csv":
        output.print(
          "client_id,client_name,created_at,redirect_uris,requested_pods",
        );
        clients.forEach((client) => {
          output.print(
            `"${client.client_id}","${client.client_name}","${client.created_at}","${client.redirect_uris.join(";")}","${client.requested_pods.join(";")}"`,
          );
        });
        break;
      default: // table
        output.print("OAuth Clients:");
        output.print("─".repeat(80));
        clients.forEach((client) => {
          output.print(`${client.client_name.padEnd(20)} ${client.client_id}`);
          output.print(
            `  Created: ${new Date(client.created_at).toLocaleDateString()}`,
          );
          output.print(`  Redirect: ${client.redirect_uris[0]}`);
          if (client.requested_pods.length > 0) {
            output.print(`  Pods: ${client.requested_pods.join(", ")}`);
          }
          output.print("");
        });
        output.print(
          `Total: ${clients.length} client${clients.length === 1 ? "" : "s"}`,
        );
    }

    logger.info("OAuth clients listed successfully", {
      count: clients.length,
      format,
    });
  } catch (error: any) {
    logger.error("OAuth list command failed", { error: error.message });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}

/**
 * Delete an OAuth client
 */
export async function oauthDelete(options: OAuthDeleteOptions): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Deleting OAuth client", {
      clientId: options.clientId,
      force: options.force,
    });

    if (!options.force) {
      output.print(
        `WARNING: This will permanently delete OAuth client '${options.clientId}'.`,
      );
      output.print("Any applications using this client will lose access.");
      output.print("Use --force to skip this confirmation.");
      logger.info("OAuth client deletion cancelled - confirmation required", {
        clientId: options.clientId,
      });
      process.exit(0);
    }

    const result = await apiRequest<void>(
      `/api/oauth/clients/${options.clientId}`,
      {
        method: "DELETE",
        token: options.token,
        server: options.server,
      },
    );

    if (!result.success) {
      if (result.error.code === "NOT_FOUND") {
        output.error(`OAuth client '${options.clientId}' not found.`);
        logger.warn("OAuth client not found for deletion", {
          clientId: options.clientId,
        });
      } else {
        output.error("Error: " + result.error.message);
        logger.error("OAuth client deletion failed", {
          clientId: options.clientId,
          error: result.error,
        });
      }
      process.exit(1);
    }

    output.success(`OAuth client '${options.clientId}' deleted successfully.`);
    logger.info("OAuth client deleted successfully", {
      clientId: options.clientId,
    });
  } catch (error: any) {
    logger.error("OAuth delete command failed", {
      clientId: options.clientId,
      error: error.message,
    });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}

/**
 * Show OAuth client details
 */
export async function oauthInfo(options: OAuthInfoOptions): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Getting OAuth client info", { clientId: options.clientId });

    const result = await apiRequest<OAuthClient>(
      `/api/oauth/clients/${options.clientId}`,
      {
        token: options.token,
        server: options.server,
      },
    );

    if (!result.success) {
      if (result.error.code === "NOT_FOUND") {
        output.error(`OAuth client '${options.clientId}' not found.`);
        logger.warn("OAuth client not found for info", {
          clientId: options.clientId,
        });
      } else {
        output.error("Error: " + result.error.message);
        logger.error("OAuth client info failed", {
          clientId: options.clientId,
          error: result.error,
        });
      }
      process.exit(1);
    }

    const client = result.data;
    const format = options.format || "table";
    logger.debug("Displaying OAuth client info", {
      clientId: options.clientId,
      format,
    });

    switch (format) {
      case "json":
        output.print(JSON.stringify(client, null, 2));
        break;
      case "yaml":
        Object.entries(client).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            output.print(`${key}: [${value.join(", ")}]`);
          } else {
            output.print(`${key}: ${value}`);
          }
        });
        break;
      case "csv":
        output.print("key,value");
        Object.entries(client).forEach(([key, value]) => {
          const val = Array.isArray(value) ? value.join(";") : value;
          output.print(`${key},"${val}"`);
        });
        break;
      default: // table
        output.print(`OAuth Client: ${client.client_name}`);
        output.print("─".repeat(40));
        output.print(`Client ID:      ${client.client_id}`);
        output.print(`Name:           ${client.client_name}`);
        output.print(
          `Created:        ${new Date(client.created_at).toLocaleString()}`,
        );
        output.print(`Redirect URIs:  ${client.redirect_uris.join(", ")}`);
        output.print(
          `Requested Pods: ${client.requested_pods.join(", ") || "None"}`,
        );
    }

    logger.info("OAuth client info displayed", {
      clientId: options.clientId,
      format,
    });
  } catch (error: any) {
    logger.error("OAuth info command failed", {
      clientId: options.clientId,
      error: error.message,
    });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}

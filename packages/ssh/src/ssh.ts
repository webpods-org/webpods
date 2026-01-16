import { Process, ProcessStartInfo } from "@tsonic/dotnet/System.Diagnostics.js";
import type { int } from "@tsonic/core/types.js";

export class SSHConfig {
  user: string | undefined;
  port: int | undefined;
  key: string | undefined;
  bastion: string | undefined;
  connectTimeoutSeconds: int | undefined;

  constructor() {
    this.user = undefined;
    this.port = undefined;
    this.key = undefined;
    this.bastion = undefined;
    this.connectTimeoutSeconds = undefined;
  }

  setPort(port: int): void {
    this.port = port;
  }

  clearPort(): void {
    this.port = undefined;
  }

  setConnectTimeoutSeconds(seconds: int): void {
    this.connectTimeoutSeconds = seconds;
  }

  clearConnectTimeoutSeconds(): void {
    this.connectTimeoutSeconds = undefined;
  }
}

export class SSHExecRequest {
  target: string;
  command: string[];
  config: SSHConfig | undefined;

  constructor(target: string, command: string[]) {
    this.target = target;
    this.command = command;
    this.config = undefined;
  }
}

export class SSHExecResult {
  readonly exitCode: int;
  readonly stdout: string;
  readonly stderr: string;

  constructor(exitCode: int, stdout: string, stderr: string) {
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export class SSH {
  private static quoteForSh(value: string): string {
    if (value === "") return "''";

    const parts = value.split("'");
    if (parts.length === 1) return `'${value}'`;

    let out = `'${parts[0] ?? ""}'`;
    for (let i = 1; i < parts.length; i++) {
      out += `'"'"'${parts[i] ?? ""}'`;
    }
    return out;
  }

  private static buildRemoteCommand(argv: string[]): string {
    let out = "";
    for (let i = 0; i < argv.length; i++) {
      if (i > 0) out += " ";
      out += SSH.quoteForSh(argv[i]!);
    }
    return out;
  }

  static exec(req: SSHExecRequest): SSHExecResult {
    const startInfo = new ProcessStartInfo();
    startInfo.fileName = "ssh";
    startInfo.redirectStandardOutput = true;
    startInfo.redirectStandardError = true;
    startInfo.useShellExecute = false;
    startInfo.createNoWindow = true;

    startInfo.argumentList.add("-o");
    startInfo.argumentList.add("BatchMode=yes");

    const cfg = req.config;
    if (cfg !== undefined) {
      if (cfg.port !== undefined) {
        startInfo.argumentList.add("-p");
        startInfo.argumentList.add(cfg.port.toString());
      }
      const key = cfg.key;
      if (key !== undefined && key.trim() !== "") {
        startInfo.argumentList.add("-i");
        startInfo.argumentList.add(key);
      }
      if (cfg.connectTimeoutSeconds !== undefined) {
        startInfo.argumentList.add("-o");
        startInfo.argumentList.add(`ConnectTimeout=${cfg.connectTimeoutSeconds.toString()}`);
      }
      const bastion = cfg.bastion;
      if (bastion !== undefined && bastion.trim() !== "") {
        startInfo.argumentList.add("-J");
        startInfo.argumentList.add(bastion);
      }
    }

    let target = req.target;
    const user = cfg?.user;
    if (user !== undefined && user.trim() !== "" && target.indexOf("@") < 0) {
      target = `${user}@${target}`;
    }

    startInfo.argumentList.add(target);

    if (req.command.length > 0) {
      startInfo.argumentList.add(SSH.buildRemoteCommand(req.command));
    }

    const process = Process.start(startInfo);
    if (process === undefined) {
      return new SSHExecResult(-1, "", "Failed to start ssh process");
    }

    process.waitForExit();

    const stdout = process.standardOutput.readToEnd() ?? "";
    const stderr = process.standardError.readToEnd() ?? "";
    return new SSHExecResult(process.exitCode, stdout, stderr);
  }
}

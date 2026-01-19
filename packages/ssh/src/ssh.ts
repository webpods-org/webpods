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

    if (value.IndexOf("'") < 0) return `'${value}'`;
    const escaped = value.Replace("'", `'"'"'`);
    return `'${escaped}'`;
  }

  private static buildRemoteCommand(argv: string[]): string {
    let out = "";
    for (let i = 0; i < argv.Length; i++) {
      if (i > 0) out += " ";
      out += SSH.quoteForSh(argv[i]!);
    }
    return out;
  }

  static exec(req: SSHExecRequest): SSHExecResult {
    const startInfo = new ProcessStartInfo();
    startInfo.FileName = "ssh";
    startInfo.RedirectStandardOutput = true;
    startInfo.RedirectStandardError = true;
    startInfo.UseShellExecute = false;
    startInfo.CreateNoWindow = true;

    startInfo.ArgumentList.Add("-o");
    startInfo.ArgumentList.Add("BatchMode=yes");

    const cfg = req.config;
    if (cfg !== undefined) {
      if (cfg.port !== undefined) {
        startInfo.ArgumentList.Add("-p");
        startInfo.ArgumentList.Add(cfg.port.ToString());
      }
      const key = cfg.key;
      if (key !== undefined && key.Trim() !== "") {
        startInfo.ArgumentList.Add("-i");
        startInfo.ArgumentList.Add(key);
      }
      if (cfg.connectTimeoutSeconds !== undefined) {
        startInfo.ArgumentList.Add("-o");
        startInfo.ArgumentList.Add(`ConnectTimeout=${cfg.connectTimeoutSeconds.ToString()}`);
      }
      const bastion = cfg.bastion;
      if (bastion !== undefined && bastion.Trim() !== "") {
        startInfo.ArgumentList.Add("-J");
        startInfo.ArgumentList.Add(bastion);
      }
    }

    let target = req.target;
    const user = cfg?.user;
    if (user !== undefined && user.Trim() !== "" && target.IndexOf("@") < 0) {
      target = `${user}@${target}`;
    }

    startInfo.ArgumentList.Add(target);

    if (req.command.Length > 0) {
      startInfo.ArgumentList.Add(SSH.buildRemoteCommand(req.command));
    }

    const process = Process.Start(startInfo);
    if (process === undefined) {
      return new SSHExecResult(-1, "", "Failed to start ssh process");
    }

    process.WaitForExit();

    const stdout = process.StandardOutput.ReadToEnd() ?? "";
    const stderr = process.StandardError.ReadToEnd() ?? "";
    return new SSHExecResult(process.ExitCode, stdout, stderr);
  }
}

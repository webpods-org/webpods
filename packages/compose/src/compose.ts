import { Process, ProcessStartInfo } from "@tsonic/dotnet/System.Diagnostics.js";
import type { int } from "@tsonic/core/types.js";

export class ComposeResolveRequest {
  workingDirectory: string;
  projectName: string;
  composeFiles: string[];
  envFile: string | undefined;

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
    this.projectName = "";
    const files: string[] = [];
    this.composeFiles = files;
    this.envFile = undefined;
  }
}

export class ComposeResolveResult {
  readonly exitCode: int;
  readonly stdout: string;
  readonly stderr: string;

  constructor(exitCode: int, stdout: string, stderr: string) {
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export class Compose {
  static resolve(req: ComposeResolveRequest): ComposeResolveResult {
    const startInfo = new ProcessStartInfo();
    startInfo.fileName = "docker";
    startInfo.workingDirectory = req.workingDirectory;
    startInfo.redirectStandardOutput = true;
    startInfo.redirectStandardError = true;
    startInfo.useShellExecute = false;
    startInfo.createNoWindow = true;

    startInfo.argumentList.add("compose");

    if (req.projectName.trim() !== "") {
      startInfo.argumentList.add("-p");
      startInfo.argumentList.add(req.projectName);
    }

    for (let i = 0; i < req.composeFiles.length; i++) {
      startInfo.argumentList.add("-f");
      startInfo.argumentList.add(req.composeFiles[i]!);
    }

    if (req.envFile !== undefined && req.envFile.trim() !== "") {
      startInfo.argumentList.add("--env-file");
      startInfo.argumentList.add(req.envFile);
    }

    startInfo.argumentList.add("config");
    startInfo.argumentList.add("--format");
    startInfo.argumentList.add("json");

    const process = Process.start(startInfo);
    if (process === undefined) {
      return new ComposeResolveResult(-1, "", "Failed to start docker process");
    }

    process.waitForExit();

    const stdout = process.standardOutput.readToEnd() ?? "";
    const stderr = process.standardError.readToEnd() ?? "";
    return new ComposeResolveResult(process.exitCode, stdout, stderr);
  }
}

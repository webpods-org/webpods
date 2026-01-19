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
    startInfo.FileName = "docker";
    startInfo.WorkingDirectory = req.workingDirectory;
    startInfo.RedirectStandardOutput = true;
    startInfo.RedirectStandardError = true;
    startInfo.UseShellExecute = false;
    startInfo.CreateNoWindow = true;

    startInfo.ArgumentList.Add("compose");

    if (req.projectName.Trim() !== "") {
      startInfo.ArgumentList.Add("-p");
      startInfo.ArgumentList.Add(req.projectName);
    }

    for (let i = 0; i < req.composeFiles.Length; i++) {
      startInfo.ArgumentList.Add("-f");
      startInfo.ArgumentList.Add(req.composeFiles[i]!);
    }

    if (req.envFile !== undefined && req.envFile.Trim() !== "") {
      startInfo.ArgumentList.Add("--env-file");
      startInfo.ArgumentList.Add(req.envFile);
    }

    startInfo.ArgumentList.Add("config");
    startInfo.ArgumentList.Add("--format");
    startInfo.ArgumentList.Add("json");

    const process = Process.Start(startInfo);
    if (process === undefined) {
      return new ComposeResolveResult(-1, "", "Failed to start docker process");
    }

    process.WaitForExit();

    const stdout = process.StandardOutput.ReadToEnd() ?? "";
    const stderr = process.StandardError.ReadToEnd() ?? "";
    return new ComposeResolveResult(process.ExitCode, stdout, stderr);
  }
}

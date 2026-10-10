import { spawn } from "node:child_process";
import { UtmError } from "./errors";

export interface RunOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProcessRunner {
  run(file: string, args: readonly string[], options: RunOptions): Promise<ProcessResult>;
}

/** No shell is involved; limits apply to the combined stdout and stderr byte count. */
export class SpawnRunner implements ProcessRunner {
  run(file: string, args: readonly string[], options: RunOptions): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(file, [...args], { stdio: ["ignore", "pipe", "pipe"], shell: false });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let size = 0;
      let failure: UtmError | undefined;
      const timer = setTimeout(() => {
        failure = new UtmError("timeout", file, `Process exceeded ${options.timeoutMs} ms`);
        child.kill("SIGKILL");
      }, options.timeoutMs);
      timer.unref();

      const collect = (chunk: Buffer, target: Buffer[]) => {
        size += chunk.length;
        if (size > options.maxOutputBytes) {
          failure = new UtmError("output_limit", file, `Process output exceeded ${options.maxOutputBytes} bytes`);
          child.kill("SIGKILL");
          return;
        }
        target.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(chunk, stdout));
      child.stderr.on("data", (chunk: Buffer) => collect(chunk, stderr));
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (!failure) failure = new UtmError("unavailable", file, error.message, error);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (failure) return reject(failure);
        if (signal) return reject(new UtmError("command_failed", file, `Process terminated by ${signal}`));
        resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exitCode: code ?? 1 });
      });
    });
  }
}

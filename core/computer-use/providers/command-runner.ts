import { spawn } from "child_process";

interface SpawnOptions {
  env?: Record<string, string>;
  windowsHide?: boolean;
  detached?: boolean;
  stdio?: any;
  unref?: boolean;
}

interface RunOptions {
  env?: Record<string, string>;
  windowsHide?: boolean;
  timeoutMs?: number;
  stdin?: any;
  signal?: AbortSignal;
  onStderr?: (chunk: string) => void;
}

export function createCommandRunner({ spawnImpl = spawn } = {}) {
  return {
    spawn(command: string, args: string[] = [], options: SpawnOptions = {}) {
      const child = spawnImpl(command, args, {
        env: options.env || process.env,
        windowsHide: options.windowsHide !== false,
        detached: options.detached !== false,
        stdio: options.stdio || "ignore",
      });
      if (options.unref !== false && typeof child.unref === "function") {
        child.unref();
      }
      return child;
    },

    run(command: string, args: string[] = [], options: RunOptions = {}) {
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) { reject(options.signal.reason); return; }
        const child = spawnImpl(command, args, {
          env: options.env || process.env,
          windowsHide: options.windowsHide !== false,
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let settled = false;
        let timer = null;
        let terminationTimer = null;
        const abort = () => {
          // Native foreground input handles SIGTERM and releases mouse-down
          // before exiting. Allow that cleanup before the hard fallback.
          try { child.kill("SIGTERM"); } catch {}
          terminationTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1000);
        };

        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (terminationTimer) clearTimeout(terminationTimer);
          options.signal?.removeEventListener('abort', abort);
          fn(value);
        };

        if (options.timeoutMs) {
          timer = setTimeout(() => {
            try { child.kill("SIGKILL"); } catch {}
            const err: Error & { code?: string } = new Error(`Command timed out after ${options.timeoutMs}ms`);
            err.code = "ETIMEDOUT";
            finish(reject, err);
          }, options.timeoutMs);
        }

        child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); options.onStderr?.(chunk.toString()); });
        child.on("error", (err) => finish(reject, err));
        child.on("close", (exitCode, signal) => {
          finish(resolve, { stdout, stderr, exitCode, signal });
        });
        options.signal?.addEventListener('abort', abort, {once:true});
        if (options.signal?.aborted) abort();

        if (options.stdin != null) {
          child.stdin?.write(String(options.stdin));
        }
        child.stdin?.end();
      });
    },
  };
}

"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createSandbox,
  destroySandbox,
  executeSandbox,
  getJob,
  getSandbox,
  jobError,
  listTemplates,
  type Job,
  type Sandbox,
  type Template,
} from "../v1";
import { hasCapability, statusLabel, type VM } from "../vm";

const STORAGE_KEY = "utm-managed-sandbox-id";
const JOB_STORAGE_KEY = "utm-managed-sandbox-job";
type JobKind = "create" | "exec" | "destroy";
interface ActiveJob {
  id: string;
  kind: JobKind;
  state: Job["state"];
}

const saveJob = (job: ActiveJob) =>
  sessionStorage.setItem(JOB_STORAGE_KEY, JSON.stringify(job));

export default function SandboxPanel({
  onInventoryChange,
  vms,
}: {
  onInventoryChange: () => void;
  vms: VM[];
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateId, setTemplateId] = useState("");
  const [network, setNetwork] = useState<"offline" | "shared">("offline");
  const [ttlMinutes, setTtlMinutes] = useState(60);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState<Sandbox | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [lastJob, setLastJob] = useState<{ kind: JobKind; job: Job } | null>(
    null,
  );
  const [argvText, setArgvText] = useState("/bin/uname\n-a");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const data = await listTemplates();
      if (!Array.isArray(data))
        throw new Error("The API returned an invalid template list.");
      setTemplates(data);
      setTemplateId((current) =>
        data.some((item) => item.id === current) ? current : data[0]?.id || "",
      );
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load approved templates",
      );
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
    setSandboxId(sessionStorage.getItem(STORAGE_KEY));
    const savedJob = sessionStorage.getItem(JOB_STORAGE_KEY);
    if (savedJob) {
      try {
        const job = JSON.parse(savedJob) as ActiveJob;
        if (
          typeof job.id === "string" &&
          ["create", "exec", "destroy"].includes(job.kind)
        ) {
          setActiveJob({ id: job.id, kind: job.kind, state: "queued" });
        }
      } catch {
        sessionStorage.removeItem(JOB_STORAGE_KEY);
      }
    }
  }, [loadTemplates]);

  useEffect(() => {
    if (!sandboxId || activeJob?.kind === "create") return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const data = await getSandbox(sandboxId);
        if (cancelled) return;
        if (
          !activeJob &&
          (data.state === "destroyed" ||
            (data.state === "failed" && !data.vmId))
        ) {
          sessionStorage.removeItem(STORAGE_KEY);
          setSandboxId(null);
          setSandbox(null);
          setError(
            "The managed sandbox has ended. You can create another one.",
          );
        } else {
          setSandbox(data);
        }
      } catch (caught) {
        if (!cancelled && activeJob?.kind !== "destroy") {
          if (
            caught instanceof ApiError &&
            caught.status === 404 &&
            !activeJob
          ) {
            sessionStorage.removeItem(STORAGE_KEY);
            setSandboxId(null);
            setSandbox(null);
            setError(
              "The managed sandbox no longer exists. You can create another one.",
            );
          } else {
            setError(
              caught instanceof Error
                ? caught.message
                : "Could not load sandbox status",
            );
          }
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sandboxId, activeJob?.kind]);

  useEffect(() => {
    if (!activeJob) return;
    let cancelled = false;
    let checking = false;
    const check = async () => {
      if (checking || cancelled) return;
      checking = true;
      try {
        const job = await getJob(activeJob.id);
        if (cancelled) return;
        setActiveJob((current) =>
          current?.id === activeJob.id
            ? { ...current, state: job.state }
            : current,
        );
        if (job.state === "succeeded" || job.state === "failed") {
          setLastJob({ kind: activeJob.kind, job });
          setActiveJob(null);
          sessionStorage.removeItem(JOB_STORAGE_KEY);
          if (job.state === "failed") {
            setError(jobError(job));
            if (activeJob.kind === "create") {
              sessionStorage.removeItem(STORAGE_KEY);
              setSandboxId(null);
              setSandbox(null);
            }
          } else if (activeJob.kind === "destroy") {
            sessionStorage.removeItem(STORAGE_KEY);
            setSandboxId(null);
            setSandbox(null);
            onInventoryChange();
          } else {
            if (sandboxId) {
              try {
                setSandbox(await getSandbox(sandboxId));
              } catch (caught) {
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "Could not load sandbox status",
                );
              }
            }
            if (activeJob.kind === "create") onInventoryChange();
          }
        }
      } catch (caught) {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not check the sandbox job",
          );
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJob?.id, sandboxId, onInventoryChange]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!templateId || busy || activeJob || sandboxId) return;
    setBusy(true);
    setError(null);
    setLastJob(null);
    try {
      const result = await createSandbox(templateId, network, ttlMinutes * 60);
      if (!result.sandboxId || !result.jobId)
        throw new Error("The API did not return sandbox and job IDs.");
      sessionStorage.setItem(STORAGE_KEY, result.sandboxId);
      saveJob({ id: result.jobId, kind: "create", state: "queued" });
      setSandboxId(result.sandboxId);
      setActiveJob({ id: result.jobId, kind: "create", state: "queued" });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create sandbox",
      );
    } finally {
      setBusy(false);
    }
  };

  const runCommand = async () => {
    const argv = argvText
      .split("\n")
      .map((arg) => arg.trim())
      .filter(Boolean);
    if (!sandboxId || argv.length === 0 || busy || activeJob) return;
    setBusy(true);
    setError(null);
    setLastJob(null);
    try {
      const result = await executeSandbox(sandboxId, argv);
      if (!result.jobId) throw new Error("The API did not return a job ID.");
      saveJob({ id: result.jobId, kind: "exec", state: "queued" });
      setActiveJob({ id: result.jobId, kind: "exec", state: "queued" });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not execute command",
      );
    } finally {
      setBusy(false);
    }
  };

  const destroy = async () => {
    if (
      !sandboxId ||
      busy ||
      activeJob ||
      !window.confirm("Destroy this managed sandbox and its clone?")
    )
      return;
    setBusy(true);
    setError(null);
    setLastJob(null);
    try {
      const result = await destroySandbox(sandboxId);
      if (!result.jobId) throw new Error("The API did not return a job ID.");
      saveJob({ id: result.jobId, kind: "destroy", state: "queued" });
      setActiveJob({ id: result.jobId, kind: "destroy", state: "queued" });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not destroy sandbox",
      );
    } finally {
      setBusy(false);
    }
  };

  const result =
    lastJob?.kind === "exec" && lastJob.job.state === "succeeded"
      ? (lastJob.job.result as
          | { stdout?: string; stderr?: string; exitCode?: number }
          | undefined)
      : undefined;
  const sandboxVm = vms.find((vm) => vm.id === sandbox?.vmId);
  const canExec = Boolean(
    sandbox &&
      (sandbox.state === "ready" || sandbox.status === "running") &&
      (sandboxVm
        ? hasCapability(sandboxVm, "guestExec")
        : hasCapability(
            { capabilities: sandbox.capabilities || {} },
            "guestExec",
          )),
  );

  return (
    <section className="sandbox-panel" aria-label="Managed sandbox">
      <div className="sandbox-heading">
        <div>
          <p className="welcome-kicker">Approved templates</p>
          <h2>Managed sandbox</h2>
        </div>
        <p>
          Clone an approved template, inspect its job, and destroy the managed
          clone when finished.
        </p>
      </div>
      {error && (
        <div className="vm-list-banner" role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              if (!sandboxId) void loadTemplates();
            }}
          >
            Retry
          </button>
        </div>
      )}
      {activeJob && (
        <p className="sandbox-job" role="status">
          {activeJob.kind === "create"
            ? "Creating"
            : activeJob.kind === "exec"
              ? "Running command"
              : "Destroying"}{" "}
          · {activeJob.state} <code>{activeJob.id}</code>
        </p>
      )}
      {lastJob && (
        <p className="sandbox-job" role="status">
          {lastJob.kind === "create"
            ? "Create"
            : lastJob.kind === "exec"
              ? "Command"
              : "Destroy"}{" "}
          job · {lastJob.job.state} <code>{lastJob.job.id}</code>
        </p>
      )}
      {!sandboxId ? (
        <form className="sandbox-form" onSubmit={(event) => void create(event)}>
          <label>
            Template
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              disabled={templatesLoading || busy}
            >
              {templates.length === 0 && (
                <option value="">No approved templates</option>
              )}
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Network
            <select
              value={network}
              onChange={(event) =>
                setNetwork(event.target.value as "offline" | "shared")
              }
            >
              <option value="offline">Offline · no guest network</option>
              <option value="shared">Shared · UTM NAT</option>
            </select>
          </label>
          <label>
            Lease (minutes)
            <input
              type="number"
              min={5}
              max={1440}
              step={1}
              value={ttlMinutes}
              onChange={(event) => setTtlMinutes(Number(event.target.value))}
            />
          </label>
          <button
            className="text-button"
            type="submit"
            disabled={
              !templateId ||
              templatesLoading ||
              busy ||
              Boolean(activeJob) ||
              !Number.isInteger(ttlMinutes) ||
              ttlMinutes < 5 ||
              ttlMinutes > 1440
            }
          >
            {busy ? "Creating…" : "Create sandbox"}
          </button>
        </form>
      ) : (
        <div className="sandbox-current">
          <dl className="vm-spec">
            <div>
              <dt>Sandbox</dt>
              <dd>
                <code>{sandboxId}</code>
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                {sandbox
                  ? statusLabel(sandbox.state || sandbox.status || "unknown")
                  : "Loading clone…"}
              </dd>
            </div>
            {(sandbox?.name || sandboxVm?.name) && (
              <div>
                <dt>VM</dt>
                <dd>{sandbox?.name || sandboxVm?.name}</dd>
              </div>
            )}
            {(sandbox?.leaseExpiresAt || sandbox?.expiresAt) && (
              <div>
                <dt>Lease ends</dt>
                <dd>
                  {new Date(
                    (sandbox.leaseExpiresAt || sandbox.expiresAt) as string,
                  ).toLocaleString()}
                </dd>
              </div>
            )}
          </dl>
          {canExec && (
            <div className="sandbox-command">
              <label>
                Guest command arguments <span>one argument per line</span>
                <textarea
                  value={argvText}
                  onChange={(event) => setArgvText(event.target.value)}
                  rows={3}
                />
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() => void runCommand()}
                disabled={busy || Boolean(activeJob) || !argvText.trim()}
              >
                Run command
              </button>
            </div>
          )}
          {result && (
            <div className="sandbox-result">
              <p>Exit code: {result.exitCode ?? "Unknown"}</p>
              {result.stdout && (
                <>
                  <h3>stdout</h3>
                  <pre>{result.stdout}</pre>
                </>
              )}
              {result.stderr && (
                <>
                  <h3>stderr</h3>
                  <pre>{result.stderr}</pre>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            className="text-button sandbox-destroy"
            onClick={() => void destroy()}
            disabled={busy || Boolean(activeJob)}
          >
            Destroy sandbox
          </button>
        </div>
      )}
    </section>
  );
}

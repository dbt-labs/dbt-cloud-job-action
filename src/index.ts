import axios from "axios";
import type { AxiosInstance } from "axios";
import * as core from "@actions/core";
import * as fs from "fs";
import * as os from "os";
import axiosRetry from "axios-retry";
import YAML from "yaml";

interface RunStatus {
  [key: number]: string;
}

interface JobRunResponse {
  data: {
    id: number;
    href: string;
    status: number;
    is_complete: boolean;
    is_error: boolean;
    git_sha: string;
    run_steps?: RunStep[];
  };
}

interface RunStep {
  name: string;
  logs: string;
}

// when updating this list, also update the constants below
interface JobRunBody {
  cause: string;
  git_sha?: string;
  git_branch?: string;
  schema_override?: string;
  dbt_version_override?: string;
  threads_override?: number;
  target_name_override?: string;
  generate_docs_override?: boolean;
  timeout_seconds_override?: number;
  steps_override?: string[];
  github_pull_request_id?: number;
}

interface ActionOutputs {
  git_sha: string;
  run_id: number;
}

(axiosRetry as (axiosInstance: unknown, config: unknown) => void)(axios, {
  retryDelay: (retryCount: number) => retryCount * 1000,
  retries: 3,
  shouldResetTimeout: true,
  onRetry: (retryCount: number) => {
    console.error(`Error in request (attempt ${retryCount}). Retrying...`);
  },
});

const run_status: RunStatus = {
  1: "Queued",
  2: "Starting",
  3: "Running",
  10: "Success",
  20: "Error",
  30: "Cancelled",
};

const dbt_cloud_api: AxiosInstance = axios.create({
  baseURL: `${core.getInput("dbt_cloud_url")}/api/v2/`,
  timeout: 5000,
  headers: {
    Authorization: `Token ${core.getInput("dbt_cloud_token")}`,
    "Content-Type": "application/json",
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const BOOL_OPTIONAL_KEYS = ["generate_docs_override"] as const;
const INTEGER_OPTIONAL_KEYS = [
  "threads_override",
  "timeout_seconds_override",
  "github_pull_request_id",
] as const;
const YAML_PARSE_OPTIONAL_KEYS = ["steps_override"] as const;
const STRING_PARSE_OPTIONAL_KEYS = [
  "git_sha",
  "git_branch",
  "schema_override",
  "dbt_version_override",
  "target_name_override",
] as const;

async function runJob(
  account_id: string,
  job_id: string,
): Promise<JobRunResponse> {
  // Handle required inputs
  const cause = core.getInput("cause");
  const body: JobRunBody = {
    cause: cause,
  };

  // Handle boolean inputs
  for (const key of BOOL_OPTIONAL_KEYS) {
    const input = core.getInput(key);
    if (input !== "") {
      body[key] = core.getBooleanInput(key);
    }
  }

  // Handle integer inputs
  for (const key of INTEGER_OPTIONAL_KEYS) {
    const input = core.getInput(key);
    if (input !== "") {
      body[key] = parseInt(input);
    }
  }

  // Handle YAML parse inputs
  for (const key of YAML_PARSE_OPTIONAL_KEYS) {
    const input = core.getInput(key);
    if (input !== "") {
      core.debug(input);
      try {
        let parsedInput = YAML.parse(input);
        if (typeof parsedInput === "string") {
          parsedInput = [parsedInput];
        }
        body[key] = parsedInput;
      } catch (e) {
        core.setFailed(
          `Could not interpret ${key} correctly. Pass valid YAML in a string.\n Example:\n  property: '["a string", "another string"]'`,
        );
        throw e;
      }
    }
  }

  // Handle string inputs
  for (const key of STRING_PARSE_OPTIONAL_KEYS) {
    const input = core.getInput(key);
    if (input !== "") {
      body[key] = input;
    }
  }

  core.debug(`Run job body:\n${JSON.stringify(body, null, 2)}`);

  const res = await dbt_cloud_api.post(
    `/accounts/${account_id}/jobs/${job_id}/run/`,
    body,
  );
  return res.data;
}

async function getJobRun(
  account_id: string,
  run_id: number,
): Promise<JobRunResponse | undefined> {
  try {
    const res = await dbt_cloud_api.get(
      `/accounts/${account_id}/runs/${run_id}/?include_related=["run_steps"]`,
    );
    return res.data;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.toString() : String(e);
    if (
      errorMsg.search("timeout of ") !== -1 &&
      errorMsg.search(" exceeded") !== -1
    ) {
      console.error(
        "Error getting job information from dbt Cloud. " +
          errorMsg +
          ". The dbt Cloud API is taking too long to respond.",
      );
    } else {
      console.error(
        "Error getting job information from dbt Cloud. " + errorMsg,
      );
    }
  }
  return undefined;
}

function validateArtifactData(data: unknown, artifactType: string): void {
  if (data === null || data === undefined) {
    throw new Error(`${artifactType} artifact data is null or undefined`);
  }
  if (typeof data !== "object") {
    throw new Error(`${artifactType} artifact data is not an object`);
  }
}

function validateRunId(id: unknown): number {
  if (id === null || id === undefined) {
    throw new Error("Run ID is null or undefined");
  }
  if (typeof id !== "number" || isNaN(id)) {
    throw new Error("Run ID is not a valid number");
  }
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Run ID must be a positive integer");
  }
  return id;
}

async function getArtifacts(account_id: string, run_id: number): Promise<void> {
  const res = await dbt_cloud_api.get(
    `/accounts/${account_id}/runs/${run_id}/artifacts/run_results.json`,
  );
  const run_results = res.data;

  let catalog_data: unknown;
  if (core.getBooleanInput("fetch_catalog")) {
    const catalog = await dbt_cloud_api.get(
      `/accounts/${account_id}/runs/${run_id}/artifacts/catalog.json`,
    );
    catalog_data = catalog.data;
  }

  const manifest = await dbt_cloud_api.get(
    `/accounts/${account_id}/runs/${run_id}/artifacts/manifest.json`,
  );
  const manifest_data = manifest.data;

  core.info("Saving artifacts in target directory");
  const dir = "./target";

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }

  validateArtifactData(run_results, "run_results");
  fs.writeFileSync(`${dir}/run_results.json`, JSON.stringify(run_results));
  if (core.getBooleanInput("fetch_catalog")) {
    validateArtifactData(catalog_data, "catalog");
    fs.writeFileSync(`${dir}/catalog.json`, JSON.stringify(catalog_data));
  }
  validateArtifactData(manifest_data, "manifest");
  fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest_data));
}

async function executeAction(): Promise<ActionOutputs> {
  const account_id = core.getInput("dbt_cloud_account_id");
  const job_id = core.getInput("dbt_cloud_job_id");
  const failure_on_error = core.getBooleanInput("failure_on_error");

  const jobRun = await runJob(account_id, job_id);
  const runId = validateRunId(jobRun.data.id);

  core.info(`Triggered job. ${jobRun.data.href}`);

  fs.appendFileSync(
    process.env.GITHUB_STATE!,
    `dbtCloudRunID=${runId}${os.EOL}`,
    {
      encoding: "utf8",
    },
  );

  let res: JobRunResponse | undefined;
  while (true) {
    await sleep(parseInt(core.getInput("interval")) * 1000);
    res = await getJobRun(account_id, runId);

    if (!res) {
      continue;
    }

    const status = run_status[res.data.status];
    core.info(`Run: ${res.data.id} - ${status}`);

    if (core.getBooleanInput("wait_for_job")) {
      if (res.data.is_complete) {
        core.info(`job finished with '${status}'`);
        break;
      }
    } else {
      core.info(
        "Not waiting for job to finish. Relevant run logs will be omitted.",
      );
      break;
    }
  }

  if (res?.data.is_error && failure_on_error) {
    core.setFailed("The job failed with an error.");
  }

  if (res?.data.is_error) {
    core.info("Loading logs...");
    await sleep(5000);
    res = await getJobRun(account_id, runId);

    if (res?.data.run_steps) {
      for (const step of res.data.run_steps) {
        core.info("# " + step.name);
        core.info(step.logs);
        core.info("\n************\n");
      }
    }
  }

  if (core.getBooleanInput("get_artifacts")) {
    await getArtifacts(account_id, runId);
  }

  return {
    git_sha: res?.data.git_sha || "",
    run_id: runId,
  };
}

async function cleanupAction(): Promise<void> {
  const account_id = core.getInput("dbt_cloud_account_id");
  const run_id = process.env.STATE_dbtCloudRunID;

  if (!run_id) {
    core.info("No run ID found in state file. Not cancelling job.");
    return;
  }

  const res = await getJobRun(account_id, parseInt(run_id));

  if (res && !res.data.is_complete && core.getBooleanInput("wait_for_job")) {
    core.info("Cancelling job...");
    await dbt_cloud_api.post(`/accounts/${account_id}/runs/${run_id}/cancel/`);
  } else {
    core.info("Nothing to clean");
  }
}

async function main(): Promise<void> {
  if (process.env.STATE_dbtCloudRunID === undefined) {
    try {
      const outputs = await executeAction();
      const git_sha = outputs.git_sha;
      const run_id = outputs.run_id;

      core.info(`dbt Cloud Job commit SHA is ${git_sha}`);
      core.setOutput("git_sha", git_sha);
      core.setOutput("run_id", run_id);
    } catch (e) {
      core.setFailed(
        "There has been a problem with running your dbt cloud job:\n" +
          String(e),
      );
      if (e instanceof Error) {
        core.debug(e.stack || "");
      }
    }
  } else {
    try {
      await cleanupAction();
    } catch (e) {
      core.error(
        "There has been a problem with cleaning up your dbt cloud job:\n" +
          String(e),
      );
      if (e instanceof Error) {
        core.debug(e.stack || "");
      }
    }
  }
}

main();

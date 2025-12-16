# dbt Cloud job action

Originally a fork of https://github.com/fal-ai/dbt-cloud-action with additional capabilities as the original repo and action seem inactive:

- adds the ability to cancel jobs when the action is cancelled
- adds the ability to provide a GitHub PR ID
- downloads more artefacts than just `run_results.json`
- rewritten from JS to TS to improve future maintenance

This action lets you trigger a job run on [dbt Cloud](https://cloud.getdbt.com), wait for the results of the job and fetch the `run_results.json`, `manifest.json` and `catalog.json` artifacts.
If your dbt cloud job does not generate docs, set `fetch_catalog: false`

## Inputs

### Credentials

- `dbt_cloud_url` - dbt Cloud [API URL](https://docs.getdbt.com/dbt-cloud/api-v2#/) (Default: `https://cloud.getdbt.com`)
- `dbt_cloud_token` - dbt Cloud [API token](https://docs.getdbt.com/docs/dbt-cloud/dbt-cloud-api/service-tokens)
- `dbt_cloud_account_id` - dbt Cloud Account ID
- `dbt_cloud_job_id` - dbt Cloud Job ID

We recommend passing sensitive variables as GitHub secrets. [Example usage](https://github.com/fal-ai/fal_bike_example/blob/main/.github/workflows/fal_dbt.yml).

### Action configuration

- `failure_on_error` - Boolean to make the action report a failure when dbt-cloud runs.
- `interval` - The interval between polls in seconds (Default: `30`)
- `get_artifacts` - Whether run results and other artifacts are fetched from dbt cloud. If using this action in other contexts this can be set to `false`, useful for jobs which do not generate artifacts.
- `fetch_catalog` - Whether the catalog.json is fetched from dbt cloud. If using this action in other contexts this can be set to `false`, useful for jobs which do not generate a catalog.

### dbt Cloud Job configuration

Use any of the [documented options for the dbt API](https://docs.getdbt.com/dbt-cloud/api-v2#tag/Jobs/operation/triggerRun).

- `cause` (Default: `Triggered by a Github Action`)
- `git_sha`
- `git_branch`
- `schema_override`
- `dbt_version_override`
- `threads_override`
- `target_name_override`
- `generate_docs_override`
- `timeout_seconds_override`
- `steps_override`: pass a YAML-parseable string. (e.g. `steps_override: '["dbt seed", "dbt run"]'`)
- `github_pull_request_id`

## Examples

### Trigger a job and override the steps

```yaml
name: Run dbt Cloud job
on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: dbt-labs/dbt-cloud-job-action@v6.0.0
        id: dbt_cloud_job_run
        with:
          dbt_cloud_token: ${{ secrets.DBT_CLOUD_API_TOKEN }}
          dbt_cloud_account_id: ${{ secrets.DBT_CLOUD_ACCOUNT_ID }}
          dbt_cloud_job_id: ${{ secrets.DBT_CLOUD_JOB_ID }}
          failure_on_error: true
          steps_override: |
            - dbt build -s my_model+
            - dbt docs generate
```

### Trigger a CI job previously created

This will trigger the CI job.
If a new commit is pushed to the PR, the current job gets cancelled and a new one is created.

```yaml
name: Run dbt Cloud CI job
on:
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: dbt-labs/dbt-cloud-job-action@v6.0.0
        id: dbt_cloud_ci_job_run
        with:
          dbt_cloud_token: ${{ secrets.DBT_CLOUD_API_TOKEN }}
          dbt_cloud_account_id: ${{ secrets.DBT_CLOUD_ACCOUNT_ID }}
          dbt_cloud_job_id: ${{ secrets.DBT_CLOUD_JOB_ID }}
          git_branch: ${{ github.head_ref }}
          target_name_override: dbt_pr_${{ github.event.pull_request.number }}
          github_pull_request_id: ${{ github.event.pull_request.number }}
          cause: "CI job triggered from GH action"
          failure_on_error: true
```

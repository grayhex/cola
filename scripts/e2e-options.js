// Options of one browser run (#386): the Playwright project and the shard of
// its tests. They come from the environment of a CI job or from the command
// line of a local run, are checked before anything is started, and reach the
// native `playwright test` as `--project` and `--shard`.
//
//   COLA_CI_PLAYWRIGHT_PROJECT=chromium pnpm test:e2e --shard=2/2
//   COLA_CI_PLAYWRIGHT_PROJECT=webkit-mobile COLA_CI_PLAYWRIGHT_SHARD=1/2 pnpm test:e2e
//   pnpm test:e2e --project=chromium tests/e2e/bike-tabs.spec.js   (one file)
export const projects = ["chromium", "webkit-mobile"];
const maxShards = 16;

/** `2/4` → `{ current: 2, total: 4 }`; anything else is refused. */
export function parseShard(value) {
  const match = /^([1-9]\d{0,2})\/([1-9]\d{0,2})$/.exec(String(value ?? ""));
  if (!match)
    throw new Error(
      `Shard must be written as "index/total" (for example 2/4), got "${value}"`,
    );
  const [current, total] = [Number(match[1]), Number(match[2])];
  if (total > maxShards || current > total)
    throw new Error(
      `Shard ${value} is not valid: 1 <= index <= total <= ${maxShards}`,
    );
  return { current, total };
}

const valueOptions = ["--project", "--shard"];
function option(argv, name) {
  const found = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) found.push(argv[i + 1]);
    else if (argv[i].startsWith(name + "="))
      found.push(argv[i].slice(name.length + 1));
  }
  if (found.length > 1) throw new Error(`${name} is given more than once`);
  if (found.length === 1 && !found[0]) throw new Error(`${name} needs a value`);
  return found[0];
}
/** Files or title filters of the command line: what is not an option or its value. */
function filters(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (valueOptions.includes(argv[i])) i++;
    else if (!argv[i].startsWith("-")) out.push(argv[i]);
  }
  return out;
}

/**
 * The project, the shard and the file filters of the run. The command line
 * wins over the environment; a project outside `projects` and a malformed
 * shard stop the run, so a typo can never become a silent full run.
 */
export function browserRun(argv = [], env = {}) {
  const project =
    option(argv, "--project") ?? (env.COLA_CI_PLAYWRIGHT_PROJECT || undefined);
  if (project !== undefined && !projects.includes(project))
    throw new Error(
      `Unknown Playwright project "${project}"; expected one of ${projects.join(", ")}`,
    );
  const text =
    option(argv, "--shard") ?? (env.COLA_CI_PLAYWRIGHT_SHARD || undefined);
  const shard = text === undefined ? null : parseShard(text);
  if (shard && !project)
    throw new Error(
      "A shard needs its project: set COLA_CI_PLAYWRIGHT_PROJECT or --project, so that the shards of every browser stay separate",
    );
  return { project, shard, files: filters(argv) };
}

/** The arguments of the native Playwright command for the run. */
export function playwrightArgs({ project, shard, files = [] }, extra = []) {
  // The filters come first: `--project` takes every word after it for a project.
  return [
    "test",
    ...files,
    ...(project ? ["--project", project] : []),
    ...(shard ? ["--shard", `${shard.current}/${shard.total}`] : []),
    ...extra,
  ];
}

/** `1of2`: the shard in names of files and artifacts. */
export const shardLabel = (shard) =>
  shard ? `${shard.current}of${shard.total}` : "all";

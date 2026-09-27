#!/usr/bin/env python3
"""Disposable Buildx/GHA comparison; never loads, runs or publishes app images."""
import datetime, gzip, json, os, pathlib, subprocess, sys, tarfile, tempfile, time

variant, revision = sys.argv[1:3]
assert variant in ('baseline', 'candidate')
revision = subprocess.check_output(['git', 'rev-parse', '--verify', '--end-of-options', revision + '^{commit}'], text=True).strip()
assert len(revision) == 40 and all(c in '0123456789abcdef' for c in revision)
out = pathlib.Path(os.environ['RUNNER_TEMP']) / ('docker-benchmark-' + variant)
out.mkdir(exist_ok=True)
scope = 'cola-benchmark-' + os.environ['GITHUB_RUN_ID'] + '-' + os.environ['GITHUB_RUN_ATTEMPT'] + '-' + variant
context = pathlib.Path(tempfile.mkdtemp(prefix='cola-build-context-'))
subprocess.run(['git', 'worktree', 'add', '--detach', str(context), revision], check=True)
results = []

def stamp(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()

def progress(log):
    vertices, transfers = {}, {}
    for line in log.read_text().splitlines():
        try: row = json.loads(line)
        except ValueError: continue
        # Buildx emits raw SolveStatus members individually; retain compatibility
        # with the grouped representation used by BuildKit history exporters.
        for v in row.get('vertexes', [row] if 'name' in row and 'id' in row else []):
            key = v.get('digest', v.get('id'))
            vertices.setdefault(key, {'id': key}).update(v)
        for s in row.get('statuses', [row] if 'total' in row else []):
            transfers[(s.get('vertex'), s.get('id'))] = s
    export = [v for v in vertices.values() if 'exporting to GitHub Actions Cache' in v.get('name', '')]
    cache_seconds = sum(stamp(v['completed']) - stamp(v['started']) for v in export if v.get('completed') and v.get('started'))
    ids = {v['id'] for v in export}
    uploaded = sum(s.get('current', 0) for s in transfers.values() if s.get('vertex') in ids)
    return {
        'cache_export_seconds': round(cache_seconds, 2),
        'cache_progress_bytes': uploaded,
        'vertices': [{k: v[k] for k in ('name', 'cached', 'started', 'completed') if k in v} for v in vertices.values()],
        'transfers': list(transfers.values()),
    }

def image_metrics(file):
    with tarfile.open(file) as archive:
        def blob(d): return archive.extractfile('blobs/' + d.replace(':', '/')).read()
        index = json.load(archive.extractfile('index.json'))
        manifest = json.loads(blob(index['manifests'][0]['digest']))
        config = json.loads(blob(manifest['config']['digest']))
        history = iter(h for h in config['history'] if not h.get('empty_layer'))
        layers = []
        for layer in manifest['layers']:
            raw = blob(layer['digest'])
            unpacked = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
            layers.append({'digest': layer['digest'], 'compressed': len(raw), 'uncompressed': len(unpacked), 'command': next(history).get('created_by', '')})
        return {'compressed_bytes': sum(l['compressed'] for l in layers), 'uncompressed_bytes': sum(l['uncompressed'] for l in layers), 'layers': layers}

def build(label, read_cache, write_cache):
    builder = 'cola-bench-' + variant + '-' + label
    subprocess.run(['docker', 'buildx', 'create', '--name', builder, '--driver', 'docker-container', '--bootstrap'], check=True)
    image = out / (label + '.tar')
    log = out / (label + '.jsonl')
    command = ['docker', 'buildx', 'build', '--builder', builder, '--progress=rawjson', '--provenance=false', '--output', 'type=oci,dest=' + str(image), '--target', 'runner']
    if read_cache: command += ['--cache-from', 'type=gha,version=2,scope=' + scope]
    if write_cache: command += ['--cache-to', 'type=gha,version=2,scope=' + scope + ',mode=max']
    command.append(str(context))
    try:
        started = time.monotonic()
        with log.open('w') as output:
            result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT)
        elapsed = round(time.monotonic() - started, 2)
        if result.returncode:
            print(log.read_text()[-14000:])
            raise RuntimeError('Build failed: ' + label)
        data = {'scenario': label, 'seconds': elapsed, 'cache_write': write_cache, **progress(log), **image_metrics(image)}
        results.append(data)
        (out / 'results.json').write_text(json.dumps({'variant': variant, 'revision': revision, 'scope': scope, 'runs': results}, indent=2))
        print(json.dumps({k: v for k, v in data.items() if k not in ('vertices', 'transfers', 'layers')}), flush=True)
    finally:
        image.unlink(missing_ok=True)
        subprocess.run(['docker', 'buildx', 'rm', builder], check=False)

try:
    build('cold', False, True)
    source = context / 'app/ui/home.jsx'
    original = source.read_text()
    source.write_text(original + '\n// Reproducible source-only cache probe.\n')
    build('warm-source', True, True)
    build('warm-repeat', True, True)
    source.write_text(original + '\n// Reproducible second source-only cache probe.\n')
    build('warm-read-only', True, False)
    source.write_text(original + '\n// Reproducible source-only cache probe.\n')
    (context / 'public/cache-probe.txt').write_text('Public asset change must not compile Next again.\n')
    build('warm-public', True, False)
    summary = '| Scenario | Build/export s | Compressed MiB | Uncompressed MiB | GHA export s | Cache progress MiB |\n|---|---:|---:|---:|---:|---:|\n'
    for r in results:
        summary += f"| {r['scenario']} | {r['seconds']} | {r['compressed_bytes']/2**20:.2f} | {r['uncompressed_bytes']/2**20:.2f} | {r['cache_export_seconds']} | {r['cache_progress_bytes']/2**20:.2f} |\n"
    text = f'### Docker benchmark: {variant}\n\nCommit: `{revision}`. Fresh BuildKit daemon per run; warm imports GHA. OCI export; no local image load.\n\n' + summary
    text += '\nCache progress bytes are bytes reported by BuildKit, not billed storage. Raw progress and per-layer sizes are attached. Cache mounts are intentionally cold in each fresh daemon.\n'
    (out / 'summary.md').write_text(text)
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f: f.write(text)
finally:
    subprocess.run(['git', 'worktree', 'remove', '--force', str(context)], check=False)

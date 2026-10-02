#!/usr/bin/env python3
"""Load only images from the trusted main CI artifact. Install root-owned."""

import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

REPOSITORY = "grayhex/cola"
MAX_ARCHIVE_BYTES = 4 * 1024**3


def require(condition, message):
    if not condition:
        raise ValueError(message)


def github_get(path):
    # Public metadata only. No token, endpoint override or client-supplied URL.
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/{path}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "colabike-deploy"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def artifact_name(sha, attempt):
    return f"production-images-{sha}-{attempt}"


def trusted_artifact(sha, run_id, attempt):
    require(re.fullmatch(r"[0-9a-f]{40}", sha), "Invalid commit SHA")
    require(re.fullmatch(r"[1-9][0-9]*", run_id), "Invalid run ID")
    require(re.fullmatch(r"[1-9][0-9]*", attempt), "Invalid run attempt")
    run = github_get(f"actions/runs/{run_id}")
    require(
        run["id"] == int(run_id)
        and run["run_attempt"] == int(attempt)
        and run["head_sha"] == sha
        and run["head_branch"] == "main"
        and run["repository"]["full_name"] == REPOSITORY
        and run["head_repository"]["full_name"] == REPOSITORY,
        "CI repository, main SHA or attempt mismatch",
    )
    if run["event"] == "push" and run["path"] == ".github/workflows/check.yml":
        require(run["status"] == "completed" and run["conclusion"] == "success", "CI did not succeed")
    elif run["event"] == "workflow_dispatch" and run["path"] == ".github/workflows/deploy.yml":
        # Reusable CI runs inside the still-running manual Deploy workflow.
        require(run["status"] == "in_progress", "Manual deployment is not running")
        jobs = github_get(f"actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100")
        require(jobs["total_count"] <= 100, "Unexpected manual workflow job count")
        checks = [job for job in jobs["jobs"] if job["name"] == "verify-manual / check"]
        require(
            len(checks) == 1 and checks[0]["status"] == "completed"
            and checks[0]["conclusion"] == "success" and checks[0]["head_sha"] == sha,
            "Manual verification did not succeed",
        )
    else:
        raise ValueError("Untrusted CI event or workflow")
    result = github_get(f"actions/runs/{run_id}/artifacts?per_page=100")
    require(result["total_count"] <= 100, "Unexpected artifact count")
    matches = [a for a in result["artifacts"] if a["name"] == artifact_name(sha, attempt)]
    require(len(matches) == 1, "Missing or ambiguous production image artifact; rerun full CI")
    artifact = matches[0]
    require(
        not artifact["expired"] and artifact["workflow_run"]["id"] == int(run_id)
        and artifact["workflow_run"]["head_sha"] == sha
        and re.fullmatch(r"sha256:[0-9a-f]{64}", artifact.get("digest") or "")
        and 0 < artifact["size_in_bytes"] <= MAX_ARCHIVE_BYTES,
        "Expired, invalid or oversized image artifact",
    )
    return artifact


def receive_archive(source, destination, artifact):
    """Authenticate the complete ZIP before parsing it or invoking Docker."""
    expected_size = artifact["size_in_bytes"]
    require(0 < expected_size <= MAX_ARCHIVE_BYTES, "Invalid archive size")
    digest = hashlib.sha256()
    size = 0
    with destination.open("wb") as target:
        while chunk := source.read(min(1024**2, expected_size + 1 - size)):
            size += len(chunk)
            require(size <= expected_size, "Image artifact exceeds declared size")
            digest.update(chunk)
            target.write(chunk)
    require(size == expected_size, "Truncated image artifact")
    require(f"sha256:{digest.hexdigest()}" == artifact["digest"], "Image artifact digest mismatch")


def unpack_images(archive, destination):
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        require(len(entries) == 1 and entries[0].filename == "images.tar.gz", "Unexpected artifact contents")
        require(0 < entries[0].file_size <= MAX_ARCHIVE_BYTES, "Oversized image bundle")
        with bundle.open(entries[0]) as source, destination.open("wb") as target:
            shutil.copyfileobj(source, target)


def image_tags(sha):
    return {"app": f"cola-ci-app:{sha}", "migrate": f"cola-ci-ops:{sha}",
            "bike-resolver": f"cola-ci-resolver:{sha}"}


def inspect_bundle(bundle, sha):
    expected = set(image_tags(sha).values())
    images = {}
    with tarfile.open(bundle, "r:gz") as archive:
        manifest = json.load(archive.extractfile("manifest.json"))
        require(len(manifest) == 3, "Expected exactly three production images")
        for entry in manifest:
            tags = entry["RepoTags"]
            require(len(tags) == 1 and tags[0] in expected and tags[0] not in images, "Unexpected image tag")
            config_bytes = archive.extractfile(entry["Config"]).read()
            config = json.loads(config_bytes)
            require(config["os"] == "linux" and config["architecture"] == "amd64", "Unsupported image platform")
            require(config["config"]["Labels"]["org.opencontainers.image.revision"] == sha, "Image revision mismatch")
            images[tags[0]] = f"sha256:{hashlib.sha256(config_bytes).hexdigest()}"
    require(set(images) == expected, "Missing production image")
    return images


def command_json(command):
    # Compose output includes environment values: never print it on failure.
    result = subprocess.run(command, capture_output=True, text=True, timeout=60, check=True)
    return json.loads(result.stdout)


def load_images(bundle, sha, compose):
    require(command_json(["docker", "info", "--format", "{{json .Architecture}}"])
            in ("x86_64", "amd64"), "Production image requires an amd64 Docker host")
    images = inspect_bundle(bundle, sha)
    # --print resolves the real project-scoped tags without building anything.
    targets = command_json([*compose, "build", "--print"])["target"]
    require(set(targets) == set(image_tags(sha)), "Unexpected Compose build targets")
    aliases = {service: target["tags"] for service, target in targets.items()}
    require(all(len(tags) == 1 for tags in aliases.values()), "Ambiguous Compose image tags")
    subprocess.run(["docker", "image", "load", "--input", str(bundle)], check=True, timeout=240)
    # Verify every identity before changing any production alias.
    for tag, expected_id in images.items():
        loaded = command_json(["docker", "image", "inspect", tag])[0]
        require(loaded["Id"] == expected_id, "Loaded image identity mismatch")
    for service, tag in image_tags(sha).items():
        subprocess.run(["docker", "image", "tag", images[tag], aliases[service][0]], check=True, timeout=30)


def main():
    require(len(sys.argv) >= 7 and sys.argv[4] == "--", "Expected SHA RUN_ID ATTEMPT -- docker compose ...")
    sha, run_id, attempt = sys.argv[1:4]
    compose = sys.argv[5:]
    require(compose[:2] == ["docker", "compose"], "Expected Docker Compose")
    artifact = trusted_artifact(sha, run_id, attempt)
    print(f"Receiving verified CI images: run={run_id} attempt={attempt} bytes={artifact['size_in_bytes']}", flush=True)
    with tempfile.TemporaryDirectory(prefix="colabike-images-") as directory:
        archive = Path(directory) / "artifact.zip"
        bundle = Path(directory) / "images.tar.gz"
        receive_archive(sys.stdin.buffer, archive, artifact)
        unpack_images(archive, bundle)
        load_images(bundle, sha, compose)
    print("Verified CI images loaded; no VPS build needed", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError, tarfile.TarError, zipfile.BadZipFile) as error:
        print(f"Image deployment refused: {error}", file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""Deployment trust boundaries; --docker also round-trips the actual CI images."""

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("deploy_images", ROOT / "ops/deploy-cola-images.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
SHA = "a" * 40
RUN = {"id": 123, "run_attempt": 2, "head_sha": SHA, "head_branch": "main",
       "repository": {"full_name": "grayhex/cola"}, "head_repository": {"full_name": "grayhex/cola"},
       "event": "push", "path": ".github/workflows/check.yml", "status": "completed", "conclusion": "success"}
ARTIFACT = {"name": deploy.artifact_name(SHA, "2"), "expired": False,
            "workflow_run": {"id": 123, "head_sha": SHA}, "size_in_bytes": 42, "digest": "sha256:" + "b" * 64}
JOB = {"name": "verify-manual / check", "head_sha": SHA, "status": "completed", "conclusion": "success"}


class TrustTests(unittest.TestCase):
    def verify(self, run=None, artifact=None, jobs=None):
        def api(path):
            if "/jobs?" in path:
                items = [JOB] if jobs is None else jobs
                return {"total_count": len(items), "jobs": items}
            if "/artifacts?" in path:
                return {"total_count": 1, "artifacts": [artifact or ARTIFACT]}
            return run or RUN
        with patch.object(deploy, "github_get", side_effect=api):
            return deploy.trusted_artifact(SHA, "123", "2")

    def test_successful_main_push(self):
        self.assertEqual(self.verify(), ARTIFACT)

    def test_untrusted_or_unsuccessful_runs(self):
        for key, value in [("event", "pull_request"), ("event", "workflow_dispatch"),
                           ("path", ".github/workflows/other.yml"), ("head_sha", "c" * 40),
                           ("head_branch", "feature"), ("run_attempt", 1), ("id", 456),
                           ("status", "in_progress"), ("conclusion", "failure"),
                           ("conclusion", "cancelled"), ("head_repository", {"full_name": "fork/cola"}),
                           ("repository", {"full_name": "fork/cola"})]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.verify({**RUN, key: value})

    def test_manual_deploy_requires_current_aggregate_check(self):
        run = {**RUN, "event": "workflow_dispatch", "path": ".github/workflows/deploy.yml",
               "status": "in_progress", "conclusion": None}
        self.assertEqual(self.verify(run), ARTIFACT)
        for jobs in [[], [{**JOB, "conclusion": "failure"}], [{**JOB, "status": "queued"}],
                     [{**JOB, "name": "check"}], [{**JOB, "head_sha": "c" * 40}]]:
            with self.subTest(jobs=jobs), self.assertRaises(ValueError):
                self.verify(run, jobs=jobs)

    def test_wrong_expired_or_unsigned_artifact(self):
        for key, value in [("name", deploy.artifact_name(SHA, "1")), ("expired", True),
                           ("digest", None), ("size_in_bytes", deploy.MAX_ARCHIVE_BYTES + 1),
                           ("workflow_run", {"id": 456, "head_sha": SHA}),
                           ("workflow_run", {"id": 123, "head_sha": "c" * 40})]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.verify(artifact={**ARTIFACT, key: value})

    def test_invalid_identifiers_never_query_github(self):
        with patch.object(deploy, "github_get") as api:
            for args in [("main", "123", "2"), (SHA, "../123", "2"), (SHA, "123", "0")]:
                with self.assertRaises(ValueError):
                    deploy.trusted_artifact(*args)
            api.assert_not_called()


class ArchiveTests(unittest.TestCase):
    def test_full_digest_and_size_required(self):
        content = b"authenticated archive"
        metadata = {"size_in_bytes": len(content), "digest": "sha256:" + hashlib.sha256(content).hexdigest()}
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "archive.zip"
            deploy.receive_archive(io.BytesIO(content), target, metadata)
            self.assertEqual(target.read_bytes(), content)
            for altered in [content[:-1], content + b"x", b"X" + content[1:]]:
                with self.assertRaises(ValueError):
                    deploy.receive_archive(io.BytesIO(altered), target, metadata)

    def test_no_path_extraction_or_extra_files(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, output = Path(directory) / "test.zip", Path(directory) / "images.tar.gz"
            for names in [["../images.tar.gz"], ["images.tar.gz", "extra"], ["images.tar.gz", "images.tar.gz"]]:
                with zipfile.ZipFile(archive, "w") as bundle:
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore", UserWarning)
                        for name in names:
                            bundle.writestr(name, b"test")
                with self.assertRaises(ValueError):
                    deploy.unpack_images(archive, output)
                self.assertFalse(output.exists())

    def bundle(self, path, config_change=None, extra_image=False):
        manifest = []
        with tarfile.open(path, "w:gz") as archive:
            for tag in deploy.image_tags(SHA).values():
                config = {"os": "linux", "architecture": "amd64", "config": {
                    "Labels": {"org.opencontainers.image.revision": SHA}}, "test_tag": tag}
                if config_change:
                    config_change(config)
                content = json.dumps(config).encode()
                name = hashlib.sha256(content).hexdigest() + ".json"
                entry = tarfile.TarInfo(name)
                entry.size = len(content)
                archive.addfile(entry, io.BytesIO(content))
                manifest.append({"RepoTags": [tag], "Config": name})
            if extra_image:
                manifest.append({**manifest[0], "RepoTags": ["unexpected:latest"]})
            content = json.dumps(manifest).encode()
            entry = tarfile.TarInfo("manifest.json")
            entry.size = len(content)
            archive.addfile(entry, io.BytesIO(content))

    def test_image_identity_revision_platform_and_extra_tags(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory) / "images.tar.gz"
            self.bundle(bundle)
            self.assertEqual(set(deploy.inspect_bundle(bundle, SHA)), set(deploy.image_tags(SHA).values()))
            changes = [lambda c: c.update(architecture="arm64"),
                       lambda c: c["config"]["Labels"].update({"org.opencontainers.image.revision": "c" * 40})]
            for change in changes:
                self.bundle(bundle, config_change=change)
                with self.assertRaises(ValueError):
                    deploy.inspect_bundle(bundle, SHA)
            self.bundle(bundle, extra_image=True)
            with self.assertRaises(ValueError):
                deploy.inspect_bundle(bundle, SHA)


class ForcedCommandTests(unittest.TestCase):
    def test_command_grammar_and_literal_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            for command, body in {"logger": "exit 0", "sudo": 'printf "%s\\n" "$@"'}.items():
                script = directory / command
                script.write_text("#!/bin/sh\n" + body + "\n")
                script.chmod(0o755)
            for request in [SHA, f"{SHA} prebuilt 123 2", f"{SHA}; id", f"{SHA} prebuilt 123 2 extra",
                            f"{SHA} prebuilt 0 2", f"{SHA}\n", f"{SHA}  prebuilt 123 2"]:
                result = subprocess.run(["bash", str(ROOT / "ops/deploy-cola-ssh")], capture_output=True, text=True,
                                        env={**os.environ, "PATH": f"{directory}:/usr/bin:/bin", "SSH_ORIGINAL_COMMAND": request})
                valid = request in [SHA, f"{SHA} prebuilt 123 2"]
                self.assertEqual(result.returncode, 0 if valid else 64, result.stderr)
                if valid:
                    self.assertEqual(result.stdout.splitlines(), ["-n", "/usr/local/sbin/deploy-cola", *request.split(" ")])
                else:
                    self.assertEqual(result.stdout, "")

    def test_prebuilt_failure_never_builds_or_records_success(self):
        self.wrapper(prebuilt_exit=1)

    def test_prebuilt_success_uses_no_build_and_records_commit(self):
        self.wrapper(prebuilt_exit=0)

    def wrapper(self, prebuilt_exit):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            repo, state, commands = directory / "repo", directory / "state", directory / "commands"
            (repo / ".git").mkdir(parents=True)
            state.mkdir()
            (state / "verified-sha").write_text("previous\n")
            helper = directory / "images.py"
            helper.write_text(f"raise SystemExit({prebuilt_exit})\n")
            # Keep the actual control flow; substitute only host paths and commands.
            source = (ROOT / "ops/deploy-cola").read_text()
            source = source.replace("repo=/opt/stacks/cola", f"repo={repo}")
            source = source.replace("state_dir=/var/lib/colabike", f"state_dir={state}")
            source = source.replace("/var/lock/colabike-deploy.lock", str(directory / "deploy.lock"))
            source = source.replace("/usr/local/sbin/deploy-cola-images.py", str(helper))
            wrapper = directory / "deploy"
            wrapper.write_text(source)
            fixtures = {
                "runuser": 'shift 3; exec "$@"',
                "git": f'if [ "$3" = rev-parse ]; then echo {SHA}; fi',
                "docker": f'printf "%s\\n" "$*" >> "{commands}"',
            }
            for name, body in fixtures.items():
                script = directory / name
                script.write_text("#!/bin/sh\n" + body + "\n")
                script.chmod(0o755)
            result = subprocess.run(["bash", str(wrapper), SHA, "prebuilt", "123", "2"],
                                    capture_output=True, text=True,
                                    env={**os.environ, "PATH": f"{directory}:/usr/bin:/bin"})
            self.assertEqual(result.returncode, prebuilt_exit, result.stderr)
            calls = commands.read_text().splitlines()
            self.assertFalse(any("--build" in call for call in calls), calls)
            if prebuilt_exit:
                self.assertEqual(calls, ["compose config --quiet"])
                self.assertEqual((state / "verified-sha").read_text(), "previous\n")
            else:
                self.assertIn("compose up --no-build -d --wait --wait-timeout 180", calls)
                self.assertEqual((state / "verified-sha").read_text(), SHA + "\n")


def docker_round_trip(sha, bundle):
    before = deploy.inspect_bundle(bundle, sha)
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        uploaded, received, extracted = (directory / name for name in ["uploaded.zip", "received.zip", "images.tar.gz"])
        with zipfile.ZipFile(uploaded, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.write(bundle, "images.tar.gz")
        with uploaded.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
            source.seek(0)
            deploy.receive_archive(source, received, {"digest": f"sha256:{digest}", "size_in_bytes": uploaded.stat().st_size})
        deploy.unpack_images(received, extracted)
        # Remove source names so loading really has to restore them.
        subprocess.run(["docker", "image", "rm", *before], check=True)
        fixture_env = {"POSTGRES_PASSWORD": "1a" * 32, "APP_ORIGIN": "https://colabike.ru", "COOKIE_SECURE": "true",
                       "TRUSTED_PROXY_KEY": "2b" * 32, "BIKE_RESOLVER_TOKEN": "3c" * 32}
        with patch.dict(os.environ, fixture_env):
            for file in ["compose.yaml", "compose.prod.yaml"]:
                compose = ["docker", "compose", "-p", "cola-image-roundtrip", "-f", str(ROOT / file)]
                deploy.load_images(extracted, sha, compose)
                targets = deploy.command_json([*compose, "build", "--print"])["target"]
                aliases = [targets[service]["tags"][0] for service in deploy.image_tags(sha)]
                try:
                    for service, tag in deploy.image_tags(sha).items():
                        alias = targets[service]["tags"][0]
                        actual = deploy.command_json(["docker", "image", "inspect", alias])[0]["Id"]
                        assert actual == before[tag], f"Changed image identity: {service}"
                        subprocess.run(["docker", "run", "--rm", "--entrypoint", "node", alias, "--version"], check=True)
                finally:
                    subprocess.run(["docker", "image", "rm", *aliases], check=True)
    print("Deployment images: authenticated archive round-trip, identical IDs, both Compose projects, all three runtimes OK")


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--docker":
        docker_round_trip(sys.argv[2], Path(sys.argv[3]))
    else:
        unittest.main()

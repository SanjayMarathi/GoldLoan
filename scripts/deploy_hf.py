"""Deploy the app to a Hugging Face Docker Space.     npm run deploy:hf      (or: python scripts/deploy_hf.py)

What it does
  1. Reads the Space's settings from .env.hf (git-ignored): DATABASE_URL, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL.
  2. Creates the Space <your-username>/gold-loan-portal (Docker) if it does not exist yet.
  3. Stores DATABASE_URL and LLM_API_KEY as encrypted Space *secrets*, LLM_BASE_URL / LLM_MODEL as variables.
  4. Uploads the committed code only (git archive HEAD – never a .env file), with a README header that tells
     Hugging Face to build the Dockerfile and serve port 4000.
Hugging Face then builds the image and starts the app; on first start the app creates its tables in your database.

Needs: pip install huggingface_hub  and  hf auth login  (a token with WRITE access).
Options: --space NAME (default gold-loan-portal) · --private · --dry-run (prepare and show, upload nothing)
"""
import argparse
import io
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECRETS = ("DATABASE_URL", "LLM_API_KEY")
VARIABLES = ("LLM_BASE_URL", "LLM_MODEL")

SPACE_HEADER = """---
title: Gold Loan Portal
emoji: 🪙
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 4000
pinned: false
short_description: Gold-loan intake portal with an AI loan assistant
---

"""


def read_env(path: Path) -> dict:
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            if value.strip():
                values[key.strip()] = value.strip()
    return values


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy to a Hugging Face Docker Space")
    parser.add_argument("--space", default="gold-loan-portal", help="Space name (default: gold-loan-portal)")
    parser.add_argument("--private", action="store_true", help="create the Space as private")
    parser.add_argument("--dry-run", action="store_true", help="prepare everything and show it, upload nothing")
    args = parser.parse_args()

    env_file = ROOT / ".env.hf"
    if not env_file.exists():
        print("✖ .env.hf not found. Copy .env.hf.example to .env.hf and fill it in (see docs/DEPLOY_HUGGINGFACE.md).")
        return 1
    settings = read_env(env_file)
    if "DATABASE_URL" not in settings:
        print("! DATABASE_URL is empty: the Space will keep data in memory and lose it on every restart.")
    if "LLM_API_KEY" not in settings:
        print("! LLM_API_KEY is empty: the Space will use the built-in offline assistant.")
    if git("status", "--porcelain").strip():
        print("! You have uncommitted changes. Only committed code is deployed – commit first if you want them live.")

    # 1. the code: exactly what is committed, plus the Space header on the README
    staging = Path(tempfile.mkdtemp(prefix="gold-loan-hf-"))
    with tarfile.open(fileobj=io.BytesIO(git("archive", "--format=tar", "HEAD"))) as tar:
        tar.extractall(staging, filter="data")
    readme = staging / "README.md"
    readme.write_text(SPACE_HEADER + readme.read_text(encoding="utf-8"), encoding="utf-8")
    commit = git("rev-parse", "--short", "HEAD").decode().strip()
    files = sum(1 for p in staging.rglob("*") if p.is_file())
    print(f"▶ Prepared {files} files from commit {commit} in {staging}")

    try:
        from huggingface_hub import HfApi
    except ImportError:
        print("✖ huggingface_hub is not installed: pip install huggingface_hub")
        return 1
    api = HfApi()
    try:
        user = api.whoami()["name"]
    except Exception:  # noqa: BLE001 – any auth problem means the same thing to the user
        print("✖ Not logged in to Hugging Face. Run:  hf auth login   (paste a token with WRITE access)")
        return 1
    repo_id = f"{user}/{args.space}"
    secrets = {k: settings[k] for k in SECRETS if k in settings}
    variables = {k: settings[k] for k in VARIABLES if k in settings}
    print(f"▶ Space: {repo_id}  ·  secrets: {', '.join(secrets) or 'none'}  ·  variables: {', '.join(variables) or 'none'}")
    if args.dry_run:
        print("✓ Dry run – nothing was uploaded.")
        return 0

    # 2. the Space, its secrets and variables (secrets are encrypted by Hugging Face and never shown again)
    api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True, private=args.private)
    for key, value in secrets.items():
        api.add_space_secret(repo_id, key, value)
    for key, value in variables.items():
        api.add_space_variable(repo_id, key, value)

    # 3. the code; files deleted from the repo are deleted from the Space too
    api.upload_folder(
        repo_id=repo_id,
        repo_type="space",
        folder_path=str(staging),
        commit_message=f"Deploy {commit}",
        delete_patterns=["*"],
    )
    host = f"{user}-{args.space}".lower().replace("_", "-").replace(".", "-")
    print(f"✓ Uploaded. Hugging Face is now building the image (a few minutes):")
    print(f"    Space:  https://huggingface.co/spaces/{repo_id}")
    print(f"    App:    https://{host}.hf.space   ·   health check: https://{host}.hf.space/api/v1/health")
    return 0


if __name__ == "__main__":
    sys.exit(main())

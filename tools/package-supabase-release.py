"""Package the current Supabase sources for review; never connects or applies SQL."""

from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED


ROOT = Path(__file__).resolve().parent.parent
NEW_VERSIONS = [
    "20260905100000", "20260905110000", "20260905120000",
    "20260905130000", "20260905140000",
]
EDGE_FUNCTIONS = [
    "send-email", "send-message-to-member", "send-payout-notification",
    "send-admin-payout-notification", "send-attendance-notification", "send-payout-email",
    "manage-users", "google-drive-esign", "analyze-contract", "document-storage", "planning-calendar",
]
SENSITIVE = re.compile(
    r"(^|/)(\.env(?:\.|$)|\.temp(/|$)|\.branches(/|$)|ssh-keys(/|$)|seed[^/]*\.sql$)"
    r"|(_ed25519(\.pub)?|\.(pem|key|p12|pfx))$", re.IGNORECASE
)


def package_release():
    release_id = "ekvportal-2.0-supabase-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = ROOT / "output" / "releases"
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"{release_id}.zip"
    if archive.exists():
        raise RuntimeError("A release with this timestamp already exists")

    entries = {}

    def add(source, target=None):
        name = target or source.relative_to(ROOT).as_posix()
        if SENSITIVE.search(name):
            raise RuntimeError(f"Excluded sensitive path: {name}")
        if source.is_symlink() or not source.is_file() or not source.resolve().is_relative_to(ROOT):
            raise RuntimeError(f"Not a regular workspace file: {name}")
        data = source.read_bytes()
        if re.search(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", data):
            raise RuntimeError(f"Private key material detected in {name}")
        if name in entries:
            raise RuntimeError(f"Duplicate archive path: {name}")
        entries[name] = data

    migrations = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
    versions = []
    for source in migrations:
        match = re.fullmatch(r"(\d{14})_.+\.sql", source.name)
        if not match:
            raise RuntimeError(f"Invalid migration filename: {source.name}")
        version = match.group(1)
        if version in versions:
            raise RuntimeError(f"Duplicate migration version: {version}")
        versions.append(version)
        if version in NEW_VERSIONS:
            sql = re.sub(r"--[^\n]*", "", source.read_text(encoding="utf-8")).strip()
            if not re.match(r"BEGIN\s*;", sql, re.IGNORECASE) or not re.search(r"COMMIT\s*;$", sql, re.IGNORECASE):
                raise RuntimeError(f"Missing migration transaction boundary: {source.name}")
        add(source)
    if versions[-5:] != NEW_VERSIONS:
        raise RuntimeError("The latest five migrations no longer match this release; review the deployment plan")

    for source in sorted((ROOT / "supabase" / "functions").rglob("*")):
        if source.is_file() and not SENSITIVE.search(source.relative_to(ROOT).as_posix()):
            add(source)
    for name in EDGE_FUNCTIONS:
        if f"supabase/functions/{name}/index.ts" not in entries:
            raise RuntimeError(f"Missing required Edge function: {name}")
    add(ROOT / "supabase" / "config.toml")
    add(ROOT / "supabase" / "README.md")
    for name in ["00_preflight.sql", "99_postflight.sql"]:
        add(ROOT / "supabase" / "checks" / name, f"checks/{name}")
    for name in ["active_account_authorization", "crm_atomic_workflows", "employee_workspace", "finance_attendance_hardening"]:
        add(ROOT / "supabase" / "tests" / f"{name}.sql")
    for name in ["SUPABASE_MIGRACE_2_0.md", "EKVPORTAL_2_0_BACKEND_ROLLOUT.md", "SUPABASE_MIGRATION_MAINTENANCE.md", "SUPABASE_LIVE_PREFLIGHT_20260905.md"]:
        add(ROOT / "docs" / name)

    entries["README.md"] = (
        "# EKV Portal 2.0 – Supabase\n\n"
        "Postup a pořadí spuštění: [docs/SUPABASE_MIGRACE_2_0.md](docs/SUPABASE_MIGRACE_2_0.md).\n\n"
        "Balíček obsahuje celou migrační historii pro porovnání s cílovým projektem; "
        "nových migrací je pět. Nejde o zálohu dat ani novou instalaci. "
        "SQL testy patří pouze do izolované testovací DB. "
        "Nic nebylo automaticky nasazeno ani spuštěno na Supabase.\n"
    ).encode("utf-8")
    records = [dict(path=name, bytes=len(data), sha256=sha256(data).hexdigest()) for name, data in sorted(entries.items())]
    git = lambda *args: subprocess.check_output(["git", *args], cwd=ROOT, text=True, encoding="utf-8").strip()
    manifest = {
        "releaseId": release_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "branch": git("branch", "--show-current"),
        "baseCommit": git("rev-parse", "HEAD"),
        "source": "Current working tree, including uncommitted migrations and function sources",
        "status": "Prepared only; new migrations not applied and Edge functions not deployed",
        "sqlRuntimeValidation": "New migration bodies and staging SQL tests were not executed. Read-only catalog preflight evidence is in docs/SUPABASE_LIVE_PREFLIGHT_20260905.md.",
        "migrationCount": len(migrations),
        "newMigrationVersionsInOrder": NEW_VERSIONS,
        "requiredEdgeFunctions": EDGE_FUNCTIONS,
        "fileCount": len(records),
        "files": records,
    }
    entries["RELEASE-MANIFEST.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    with ZipFile(archive, "x", compression=ZIP_DEFLATED) as bundle:
        for name, data in sorted(entries.items()):
            bundle.writestr(f"{release_id}/{name}", data)

    # Verify the actual archive, not only its input files.
    with ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise RuntimeError("Archive CRC verification failed")
        if len(bundle.namelist()) != len(entries):
            raise RuntimeError("Archive entry count mismatch")
        for record in records:
            data = bundle.read(f"{release_id}/{record['path']}")
            if len(data) != record["bytes"] or sha256(data).hexdigest() != record["sha256"]:
                raise RuntimeError(f"Archive content mismatch: {record['path']}")
    digest = sha256(archive.read_bytes()).hexdigest()
    Path(str(archive) + ".sha256").write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    print(json.dumps(dict(archive=str(archive), sha256=digest, files=len(records), migrations=len(migrations),
                         newMigrations=len(NEW_VERSIONS), bytes=archive.stat().st_size), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    package_release()

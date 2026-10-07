"""Scan reachable Git blobs without printing credential values (heuristic, not a guarantee)."""
import io
import re
import subprocess
from pathlib import Path

PATTERNS = {
    "Discord token": rb"(?:mfa\.[A-Za-z0-9_-]{60,}|[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})",
    "private key": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "AWS access key": rb"(?:AKIA|ASIA)[A-Z0-9]{16}",
    "GitHub token": rb"(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})",
    "assigned credential": rb"""(?i)(?:discord_token|discord_bot_token|api_key|client_secret)\s*[:=]\s*['"]([A-Za-z0-9_./+-]{20,})['"]""",
}
objects = subprocess.check_output(["git", "rev-list", "--objects", "--all"]).decode().splitlines()
hits = []
scanned = 0
batch = subprocess.check_output(["git", "cat-file", "--batch"],
                                input="\n".join(entry.split(" ")[0] for entry in objects).encode())
stream = io.BytesIO(batch)
texts = []
for entry in objects:
    oid, kind, size = stream.readline().decode().split()
    data = stream.read(int(size))
    stream.read(1)
    if kind == "blob":
        texts.append((oid[:12], entry.partition(" ")[2], data))
paths = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"])
for path in paths.decode().split("\0"):
    if path and Path(path).is_file():
        texts.append(("worktree", path, Path(path).read_bytes()))
for oid, path, data in texts:
    if b"\0" in data:
        continue
    scanned += 1
    for label, pattern in PATTERNS.items():
        matches = list(re.finditer(pattern, data))
        if label == "assigned credential":
            matches = [match for match in matches if not any(
                word in match.group(1).lower()
                for word in (b"your_", b"placeholder", b"replace_", b"example", b"token_here")
            )]
        if matches:
            hits.append((oid[:12], path, label))
for oid, path, label in hits:
    print(f"{label}: blob={oid} path={path} (value redacted)")
print(f"Scanned {scanned} history/worktree text files; {len(hits)} candidate findings")
raise SystemExit(bool(hits))

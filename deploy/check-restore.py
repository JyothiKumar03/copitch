"""Exercise SQLite's online backup API and verify a saved pitch in an isolated copy."""
import argparse
import hashlib
import sqlite3
import tempfile
from pathlib import Path


def artifact_fingerprint(db, research_id):
    row = db.execute(
        "SELECT session, brief, payload FROM research_bundles WHERE id = ?", (research_id,)
    ).fetchone()
    if row is None:
        raise SystemExit("The selected database does not contain that research result")
    return tuple(hashlib.sha256(field.encode()).digest() for field in row)


def check_restore(source, research_id):
    with tempfile.TemporaryDirectory() as folder:
        recovered = Path(folder, "restored.sqlite")
        original = sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)
        clone = sqlite3.connect(recovered)
        try:
            expected = artifact_fingerprint(original, research_id)
            original.backup(clone)
            if clone.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise SystemExit("SQLite integrity check failed")
            if artifact_fingerprint(clone, research_id) != expected:
                raise SystemExit("Restored artifact or ownership differs")
        finally:
            clone.close()
            original.close()
    print("OK SQLite backup restored, integrity and selected artifact ownership/content matched")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("research_id")
    args = parser.parse_args()
    check_restore(args.database, args.research_id)

#!/usr/bin/env python3
from __future__ import annotations

import json
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("uso: check-archive.py ARCHIVIO MANIFEST_XSD")

    archive = Path(sys.argv[1]).resolve(strict=True)
    manifest = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    expected = {entry["path"] for entry in manifest["entries"]}
    observed: set[str] = set()

    with zipfile.ZipFile(archive) as source:
        for info in source.infolist():
            path = PurePosixPath(info.filename)
            if path.is_absolute() or ".." in path.parts or "" in path.parts:
                raise SystemExit(f"path ZIP non sicuro: {info.filename}")
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise SystemExit(f"symlink vietato nello ZIP: {info.filename}")
            if not info.is_dir():
                observed.add(path.as_posix())

    if observed != expected:
        missing = sorted(expected - observed)
        extra = sorted(observed - expected)
        raise SystemExit(f"contenuto ZIP divergente; mancanti={missing}; extra={extra}")

    print(f"Archivio sicuro e completo: {len(observed)} file")


if __name__ == "__main__":
    main()

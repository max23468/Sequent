#!/usr/bin/env python3

import os
import re
import stat
import sys


ALLOWED_KEYS = (
    "SEQUENT_IMAGE",
    "SEQUENT_RUNTIME_UID",
    "SEQUENT_RUNTIME_GID",
    "SEQUENT_ORIGIN",
    "SEQUENT_CODEX_ENABLED",
    "SEQUENT_DIZ_ENABLED",
)
BASE_KEYS = ALLOWED_KEYS[:4]


def fail(message: str) -> None:
    raise ValueError(message)


def parse(source: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in source.splitlines():
        if not line or "=" not in line:
            fail("riga della configurazione runtime non valida")
        key, value = line.split("=", 1)
        if key not in ALLOWED_KEYS:
            fail(f"chiave runtime non ammessa: {key}")
        if key in values:
            fail(f"chiave runtime duplicata: {key}")
        values[key] = value
    if not all(key in values for key in BASE_KEYS):
        fail("configurazione runtime di base incompleta")
    return values


def main() -> None:
    if len(sys.argv) != 6:
        fail("uso: migrate-runtime-features.py FILE OWNER_UID OWNER_GID RUNTIME_UID RUNTIME_GID")
    path = os.path.abspath(sys.argv[1])
    expected_uid = int(sys.argv[2])
    expected_gid = int(sys.argv[3])
    runtime_uid = sys.argv[4]
    runtime_gid = sys.argv[5]
    metadata = os.lstat(path)
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        fail("configurazione runtime non regolare")
    if stat.S_IMODE(metadata.st_mode) != 0o600:
        fail("permessi della configurazione runtime non conformi")
    if metadata.st_uid != expected_uid or metadata.st_gid != expected_gid:
        fail("proprietario della configurazione runtime non conforme")

    with open(path, encoding="utf-8") as source:
        values = parse(source.read())
    if not (
        re.fullmatch(r"sha256:[0-9a-f]{64}", values["SEQUENT_IMAGE"])
        or re.fullmatch(r"sequent(?:-release)?:[0-9a-f]{40}", values["SEQUENT_IMAGE"])
    ):
        fail("immagine runtime non valida")
    if values["SEQUENT_RUNTIME_UID"] != runtime_uid or not runtime_uid.isdigit():
        fail("UID runtime non valido o divergente")
    if values["SEQUENT_RUNTIME_GID"] != runtime_gid or not runtime_gid.isdigit():
        fail("GID runtime non valido o divergente")
    if not re.fullmatch(r"https://[^/]+", values["SEQUENT_ORIGIN"]):
        fail("origine runtime non valida")
    has_codex = "SEQUENT_CODEX_ENABLED" in values
    has_diz = "SEQUENT_DIZ_ENABLED" in values
    if has_codex != has_diz:
        fail("configurazione runtime delle feature flag parziale")
    if has_codex:
        if values["SEQUENT_CODEX_ENABLED"] not in ("true", "false"):
            fail("flag Codex runtime non valida")
        if values["SEQUENT_DIZ_ENABLED"] not in ("true", "false"):
            fail("flag DIZ runtime non valida")
        print("OK: schema delle feature flag runtime già corrente")
        return

    values["SEQUENT_CODEX_ENABLED"] = "false"
    values["SEQUENT_DIZ_ENABLED"] = "false"
    output = "".join(f"{key}={values[key]}\n" for key in ALLOWED_KEYS)
    directory = os.path.dirname(path)
    temporary = os.path.join(directory, f".runtime.env.migration.{os.getpid()}")
    descriptor = -1
    try:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        remaining = memoryview(output.encode("utf-8"))
        while remaining:
            written = os.write(descriptor, remaining)
            if written <= 0:
                fail("scrittura della configurazione runtime incompleta")
            remaining = remaining[written:]
        os.fsync(descriptor)
        os.fchmod(descriptor, 0o600)
        os.fchown(descriptor, expected_uid, expected_gid)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, path)
        directory_descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    except Exception:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
    print("OK: feature flag runtime mancanti migrate a false")


try:
    main()
except Exception as error:
    print(f"ERRORE: {error}", file=sys.stderr)
    raise SystemExit(1)

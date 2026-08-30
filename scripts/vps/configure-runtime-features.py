#!/usr/bin/env python3

import fcntl
import os
import pwd
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


def parse_boolean(value: str, label: str) -> str:
    if value not in ("true", "false"):
        fail(f"{label} deve essere true o false")
    return value


def parse_arguments() -> tuple[str, str]:
    arguments = sys.argv[1:]
    if len(arguments) != 4:
        fail("uso: sequent-configure-runtime-features --codex true|false --diz true|false")
    values: dict[str, str] = {}
    for index in range(0, len(arguments), 2):
        option, value = arguments[index : index + 2]
        if option not in ("--codex", "--diz") or option in values:
            fail("opzioni delle feature flag non valide o duplicate")
        values[option] = parse_boolean(value, option)
    if set(values) != {"--codex", "--diz"}:
        fail("specificare entrambe le flag --codex e --diz")
    return values["--codex"], values["--diz"]


def parse_configuration(source: str) -> dict[str, str]:
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


def validate_configuration(values: dict[str, str]) -> None:
    if not (
        re.fullmatch(r"sha256:[0-9a-f]{64}", values["SEQUENT_IMAGE"])
        or re.fullmatch(r"sequent(?:-release)?:[0-9a-f]{40}", values["SEQUENT_IMAGE"])
    ):
        fail("immagine runtime non valida")
    if not values["SEQUENT_RUNTIME_UID"].isdigit():
        fail("UID runtime non valido")
    if not values["SEQUENT_RUNTIME_GID"].isdigit():
        fail("GID runtime non valido")
    if not re.fullmatch(r"https://[^/]+", values["SEQUENT_ORIGIN"]):
        fail("origine runtime non valida")
    for key in ALLOWED_KEYS[4:]:
        if key in values:
            parse_boolean(values[key], key)


def atomic_write(path: str, output: str, owner_uid: int, owner_gid: int) -> None:
    directory = os.path.dirname(path)
    temporary = os.path.join(directory, f".runtime.env.features.{os.getpid()}")
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
        os.fchown(descriptor, owner_uid, owner_gid)
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


def main() -> None:
    codex, diz = parse_arguments()
    canonical = os.geteuid() == 0
    configured_root = os.environ.get("SEQUENT_ROOT")
    if canonical and configured_root not in (None, "/opt/sequent"):
        fail("root può operare soltanto sulla radice Sequent canonica")
    root = "/opt/sequent" if canonical else configured_root
    if not root or not os.path.isabs(root):
        fail("radice Sequent di test assente o non assoluta")
    directory = os.path.join(root, "runtime")
    path = os.path.join(directory, "runtime.env")
    directory_metadata = os.lstat(directory)
    metadata = os.lstat(path)
    if not stat.S_ISDIR(directory_metadata.st_mode) or stat.S_ISLNK(directory_metadata.st_mode):
        fail("directory runtime non regolare")
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        fail("configurazione runtime non regolare")
    if stat.S_IMODE(metadata.st_mode) != 0o600:
        fail("permessi della configurazione runtime non conformi")

    if canonical:
        ubuntu = pwd.getpwnam("ubuntu")
        if (
            directory_metadata.st_uid != 0
            or directory_metadata.st_gid != ubuntu.pw_gid
            or stat.S_IMODE(directory_metadata.st_mode) != 0o750
        ):
            fail("layout della directory runtime non conforme")
        if metadata.st_uid != ubuntu.pw_uid or metadata.st_gid != ubuntu.pw_gid:
            fail("proprietario della configurazione runtime non conforme")
        lock_path = "/run/lock/hub-fatture-sequent-docker.lock"
        owner_uid, owner_gid = ubuntu.pw_uid, ubuntu.pw_gid
    else:
        if directory_metadata.st_uid != os.geteuid() or metadata.st_uid != os.geteuid():
            fail("fixture runtime non appartenente all’utente corrente")
        lock_path = os.path.join(root, ".runtime-features.lock")
        owner_uid, owner_gid = metadata.st_uid, metadata.st_gid

    with open(lock_path, "a", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("una build, un deploy o una manutenzione Docker è già in corso")
        with open(path, encoding="utf-8") as source:
            values = parse_configuration(source.read())
        validate_configuration(values)
        values["SEQUENT_CODEX_ENABLED"] = codex
        values["SEQUENT_DIZ_ENABLED"] = diz
        output = "".join(f"{key}={values[key]}\n" for key in ALLOWED_KEYS)
        atomic_write(path, output, owner_uid, owner_gid)
    print("OK: feature flag runtime configurate; il servizio non è stato riavviato")


try:
    main()
except Exception as error:
    print(f"ERRORE: {error}", file=sys.stderr)
    raise SystemExit(1)

#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

from lxml import etree


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("uso: compile-xsd.py PERCORSO_SCHEMA")

    schema_path = Path(sys.argv[1]).resolve(strict=True)
    parser = etree.XMLParser(no_network=True, resolve_entities=False)
    document = etree.parse(str(schema_path), parser)
    etree.XMLSchema(document)
    print(f"XSD compilato senza rete: {schema_path}")


if __name__ == "__main__":
    main()

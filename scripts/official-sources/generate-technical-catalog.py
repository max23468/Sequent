#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


XS_NAMESPACE = "http://www.w3.org/2001/XMLSchema"
XS = f"{{{XS_NAMESPACE}}}"
BUILTIN_NAMESPACE = XS_NAMESPACE


@dataclass(frozen=True)
class SchemaDocument:
    path: Path
    relative_path: str
    root: ET.Element
    target_namespace: str
    namespaces: dict[str, str]
    positions: dict[int, int]


@dataclass(frozen=True)
class SchemaNode:
    document: SchemaDocument
    node: ET.Element


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Genera il catalogo tecnico deterministico a partire dal bundle XSD ufficiale."
    )
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--main-schema", required=True)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def normalized_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.split())
    return normalized or None


def node_documentation(node: ET.Element) -> list[str]:
    result: list[str] = []
    for documentation in node.findall(f"./{XS}annotation/{XS}documentation"):
        text = normalized_text("".join(documentation.itertext()))
        if text and text not in result:
            result.append(text)
    return result


def read_namespaces(path: Path) -> dict[str, str]:
    namespaces: dict[str, str] = {}
    for _, pair in ET.iterparse(path, events=("start-ns",)):
        prefix, uri = pair
        namespaces[prefix or ""] = uri
    namespaces.setdefault("xs", XS_NAMESPACE)
    return namespaces


def load_documents(source_dir: Path) -> list[SchemaDocument]:
    documents: list[SchemaDocument] = []
    for path in sorted(source_dir.rglob("*.xsd")):
        root = ET.parse(path).getroot()
        positions = {
            id(node): index
            for index, node in enumerate(root.iter(), start=1)
        }
        documents.append(
            SchemaDocument(
                path=path,
                relative_path=path.relative_to(source_dir).as_posix(),
                root=root,
                target_namespace=root.attrib.get("targetNamespace", ""),
                namespaces=read_namespaces(path),
                positions=positions,
            )
        )
    if not documents:
        raise SystemExit(f"nessun XSD trovato in {source_dir}")
    return documents


def qualified_name(raw_name: str, document: SchemaDocument) -> tuple[str, str]:
    if ":" in raw_name:
        prefix, local_name = raw_name.split(":", 1)
        namespace = document.namespaces.get(prefix)
        if namespace is None:
            raise ValueError(
                f"prefisso XSD sconosciuto {prefix!r} in {document.relative_path}"
            )
        return namespace, local_name
    default_namespace = document.namespaces.get("")
    return default_namespace or document.target_namespace, raw_name


def qname_label(qname: tuple[str, str] | None) -> str | None:
    if qname is None:
        return None
    namespace, local_name = qname
    if namespace == BUILTIN_NAMESPACE:
        return f"xs:{local_name}"
    return f"{{{namespace}}}{local_name}" if namespace else local_name


def cardinality_value(value: str | None, default: str) -> int | str:
    normalized = value or default
    return "unbounded" if normalized == "unbounded" else int(normalized)


class CatalogGenerator:
    def __init__(self, source_dir: Path, documents: list[SchemaDocument]) -> None:
        self.source_dir = source_dir
        self.documents = documents
        self.documents_by_path = {document.relative_path: document for document in documents}
        self.global_elements: dict[tuple[str, str], SchemaNode] = {}
        self.complex_types: dict[tuple[str, str], SchemaNode] = {}
        self.simple_types: dict[tuple[str, str], SchemaNode] = {}
        self.groups: dict[tuple[str, str], SchemaNode] = {}
        self.element_paths: list[dict[str, Any]] = []
        self.unresolved: list[dict[str, str]] = []
        self.recursion_stops: list[dict[str, str]] = []
        self.choice_sequence = 0
        self._build_registries()

    def _build_registries(self) -> None:
        mappings = (
            (f"./{XS}element", self.global_elements),
            (f"./{XS}complexType", self.complex_types),
            (f"./{XS}simpleType", self.simple_types),
            (f"./{XS}group", self.groups),
        )
        for document in self.documents:
            for selector, registry in mappings:
                for node in document.root.findall(selector):
                    name = node.attrib.get("name")
                    if name:
                        registry[(document.target_namespace, name)] = SchemaNode(document, node)

    def source_pointer(self, schema_node: SchemaNode) -> str:
        position = schema_node.document.positions[id(schema_node.node)]
        return f"{schema_node.document.relative_path}#node[{position}]"

    def resolve_registry(
        self,
        raw_name: str,
        document: SchemaDocument,
        registry: dict[tuple[str, str], SchemaNode],
    ) -> tuple[tuple[str, str], SchemaNode | None]:
        qname = qualified_name(raw_name, document)
        return qname, registry.get(qname)

    def simple_constraints(
        self,
        schema_node: SchemaNode | None,
        raw_type: str | None,
        document: SchemaDocument,
        visited: frozenset[tuple[str, str]] = frozenset(),
    ) -> dict[str, Any]:
        if schema_node is None and raw_type:
            qname = qualified_name(raw_type, document)
            if qname[0] == BUILTIN_NAMESPACE:
                return {"base": qname_label(qname)}
            if qname in visited:
                return {"base": qname_label(qname), "recursive": True}
            target = self.simple_types.get(qname)
            if target is None:
                return {"base": qname_label(qname)}
            return self.simple_constraints(target, None, target.document, visited | {qname})

        if schema_node is None:
            return {}
        restriction = schema_node.node.find(f"./{XS}restriction")
        if restriction is None:
            union = schema_node.node.find(f"./{XS}union")
            if union is not None:
                return {
                    "unionMemberTypes": [
                        qname_label(qualified_name(member, schema_node.document))
                        for member in union.attrib.get("memberTypes", "").split()
                    ]
                }
            return {}

        result: dict[str, Any] = {}
        base = restriction.attrib.get("base")
        if base:
            base_qname = qualified_name(base, schema_node.document)
            result.update(
                self.simple_constraints(
                    None,
                    base,
                    schema_node.document,
                    visited,
                )
            )
            result["base"] = qname_label(base_qname)

        facets: dict[str, list[str]] = {}
        for facet in list(restriction):
            if not facet.tag.startswith(XS):
                continue
            name = facet.tag.removeprefix(XS)
            if name in {"annotation", "simpleType"}:
                continue
            value = facet.attrib.get("value")
            if value is not None:
                facets.setdefault(name, []).append(value)
        if facets:
            result["facets"] = facets
        return result

    def type_descriptor(self, schema_node: SchemaNode) -> tuple[str | None, dict[str, Any]]:
        raw_type = schema_node.node.attrib.get("type")
        inline_simple = schema_node.node.find(f"./{XS}simpleType")
        if inline_simple is not None:
            constraints = self.simple_constraints(
                SchemaNode(schema_node.document, inline_simple), None, schema_node.document
            )
            return constraints.get("base", "inline-simple"), constraints
        if raw_type:
            qname = qualified_name(raw_type, schema_node.document)
            return qname_label(qname), self.simple_constraints(None, raw_type, schema_node.document)
        return None, {}

    def complex_type_for(self, schema_node: SchemaNode) -> tuple[tuple[str, str] | None, SchemaNode | None]:
        inline = schema_node.node.find(f"./{XS}complexType")
        if inline is not None:
            return None, SchemaNode(schema_node.document, inline)
        raw_type = schema_node.node.attrib.get("type")
        if not raw_type:
            return None, None
        qname = qualified_name(raw_type, schema_node.document)
        return qname, self.complex_types.get(qname)

    def particles(self, complex_type: SchemaNode) -> list[tuple[SchemaNode, str | None]]:
        result: list[tuple[SchemaNode, str | None]] = []

        def collect(container: SchemaNode, inherited_choice: str | None = None) -> None:
            for child in list(container.node):
                local_name = child.tag.removeprefix(XS) if child.tag.startswith(XS) else ""
                child_node = SchemaNode(container.document, child)
                if local_name == "element":
                    result.append((child_node, inherited_choice))
                elif local_name in {"sequence", "all"}:
                    collect(child_node, inherited_choice)
                elif local_name == "choice":
                    self.choice_sequence += 1
                    collect(child_node, inherited_choice or f"choice-{self.choice_sequence}")
                elif local_name == "group" and child.attrib.get("ref"):
                    _, group = self.resolve_registry(
                        child.attrib["ref"], container.document, self.groups
                    )
                    if group is None:
                        self.unresolved.append(
                            {
                                "kind": "group",
                                "reference": child.attrib["ref"],
                                "source": self.source_pointer(child_node),
                            }
                        )
                    else:
                        collect(group, inherited_choice)

        complex_content = complex_type.node.find(f"./{XS}complexContent")
        if complex_content is not None:
            extension = complex_content.find(f"./{XS}extension")
            restriction = complex_content.find(f"./{XS}restriction")
            content = extension if extension is not None else restriction
            if content is not None:
                base = content.attrib.get("base")
                if base:
                    _, parent = self.resolve_registry(base, complex_type.document, self.complex_types)
                    if parent is not None:
                        result.extend(self.particles(parent))
                    elif qualified_name(base, complex_type.document)[0] != BUILTIN_NAMESPACE:
                        self.unresolved.append(
                            {
                                "kind": "complexType",
                                "reference": base,
                                "source": self.source_pointer(SchemaNode(complex_type.document, content)),
                            }
                        )
                collect(SchemaNode(complex_type.document, content))
                return result
        collect(complex_type)
        return result

    def expand_element(
        self,
        schema_node: SchemaNode,
        parent_path: str,
        inherited_min: int,
        inherited_max: int | str,
        type_stack: tuple[tuple[str, str], ...],
        choice_group: str | None,
        depth: int,
    ) -> None:
        if depth > 64:
            raise ValueError(f"profondità XSD eccessiva presso {parent_path}")

        source_node = schema_node
        ref = schema_node.node.attrib.get("ref")
        if ref:
            _, resolved = self.resolve_registry(ref, schema_node.document, self.global_elements)
            if resolved is None:
                self.unresolved.append(
                    {
                        "kind": "element",
                        "reference": ref,
                        "source": self.source_pointer(schema_node),
                    }
                )
                return
            source_node = resolved

        name = source_node.node.attrib.get("name")
        if not name:
            return
        path = f"{parent_path}/{name}" if parent_path else f"/{name}"
        own_min = cardinality_value(schema_node.node.attrib.get("minOccurs"), "1")
        own_max = cardinality_value(schema_node.node.attrib.get("maxOccurs"), "1")
        effective_min = inherited_min * int(own_min)
        if inherited_max == "unbounded" or own_max == "unbounded":
            effective_max: int | str = "unbounded"
        else:
            effective_max = int(inherited_max) * int(own_max)

        type_qname, complex_type = self.complex_type_for(source_node)
        children = self.particles(complex_type) if complex_type is not None else []
        type_name, constraints = self.type_descriptor(source_node)
        if complex_type is not None and type_name is None:
            type_name = qname_label(type_qname) or "inline-complex"
        entry = {
            "id": f"xsd:{path}",
            "name": name,
            "path": path,
            "kind": "container" if children else "field",
            "type": type_name,
            "minOccurs": own_min,
            "maxOccurs": own_max,
            "effectiveMinOccurs": effective_min,
            "effectiveMaxOccurs": effective_max,
            "nillable": source_node.node.attrib.get("nillable") == "true",
            "choiceGroup": choice_group,
            "documentation": node_documentation(source_node.node),
            "constraints": constraints,
            "sourceId": "SRC-08",
            "sourcePointer": self.source_pointer(source_node),
        }
        self.element_paths.append(entry)

        if complex_type is None:
            return
        if type_qname is not None and type_qname in type_stack:
            self.recursion_stops.append(
                {"path": path, "type": qname_label(type_qname) or "unknown"}
            )
            return
        next_stack = type_stack + ((type_qname,) if type_qname is not None else ())
        for child, child_choice in children:
            self.expand_element(
                child,
                path,
                effective_min,
                effective_max,
                next_stack,
                child_choice,
                depth + 1,
            )

    def generate(self, main_schema: str) -> dict[str, Any]:
        main_document = self.documents_by_path.get(main_schema)
        if main_document is None:
            raise ValueError(f"main schema non trovato: {main_schema}")
        roots = [
            SchemaNode(main_document, node)
            for node in main_document.root.findall(f"./{XS}element")
        ]
        if not roots:
            raise ValueError("main schema senza elementi globali")
        for root in roots:
            self.expand_element(root, "", 1, 1, (), None, 0)

        named_types: list[dict[str, Any]] = []
        for kind, registry in (("complex", self.complex_types), ("simple", self.simple_types)):
            for qname, schema_node in sorted(registry.items(), key=lambda item: item[0]):
                entry: dict[str, Any] = {
                    "name": qname_label(qname),
                    "kind": kind,
                    "documentation": node_documentation(schema_node.node),
                    "sourcePointer": self.source_pointer(schema_node),
                }
                if kind == "simple":
                    entry["constraints"] = self.simple_constraints(
                        schema_node, None, schema_node.document
                    )
                named_types.append(entry)

        fields = [entry for entry in self.element_paths if entry["kind"] == "field"]
        return {
            "schemaVersion": 2,
            "sourceId": "SRC-08",
            "mainSchema": main_schema,
            "status": "structurally-qualified" if not self.unresolved else "unresolved",
            "coverage": {
                "schemaFiles": len(self.documents),
                "rootElements": len(roots),
                "elementPaths": len(self.element_paths),
                "leafFields": len(fields),
                "namedTypes": len(named_types),
                "unresolvedReferences": len(self.unresolved),
                "recursionStops": len(self.recursion_stops),
            },
            "elements": self.element_paths,
            "types": named_types,
            "unresolvedReferences": self.unresolved,
            "recursionStops": self.recursion_stops,
        }


def main() -> None:
    arguments = parse_arguments()
    source_dir = arguments.source_dir.resolve(strict=True)
    manifest = json.loads(arguments.manifest.read_text(encoding="utf-8"))
    documents = load_documents(source_dir)
    generator = CatalogGenerator(source_dir, documents)
    catalog = generator.generate(arguments.main_schema)
    catalog["bundleId"] = manifest["bundleId"]
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    coverage = catalog["coverage"]
    print(
        "catalogo tecnico: "
        f"{coverage['schemaFiles']} XSD, "
        f"{coverage['elementPaths']} percorsi, "
        f"{coverage['leafFields']} campi, "
        f"{coverage['unresolvedReferences']} riferimenti irrisolti"
    )


if __name__ == "__main__":
    main()

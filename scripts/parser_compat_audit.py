#!/usr/bin/env python3
"""Summarize parser coverage and shared HTML/parser families.

This is a repository audit tool, not a live-site verifier. It helps identify
which parser families will benefit most from shared compatibility fixes.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path


REGISTER_RE = re.compile(r'parserFactory\.register\("([^"]+)"')
CLASS_RE = re.compile(r"class\s+(\w+)\s+extends\s+(\w+)")


@dataclass
class ParserAuditRow:
    parser_file: str
    class_name: str
    base_class: str
    hostnames: list[str]
    direct_test: bool
    has_get_chapter_urls: bool
    has_load_meta_info: bool
    has_find_chapter_title: bool


def build_rows(repo_root: Path) -> list[ParserAuditRow]:
    parser_dir = repo_root / "plugin" / "js" / "parsers"
    test_dir = repo_root / "unitTest"
    rows: list[ParserAuditRow] = []

    for parser_file in sorted(parser_dir.glob("*Parser.js")):
        content = parser_file.read_text(encoding="utf-8")
        class_match = CLASS_RE.search(content)
        class_name = class_match.group(1) if class_match else parser_file.stem
        base_class = class_match.group(2) if class_match else "<unknown>"
        hostnames = REGISTER_RE.findall(content)
        direct_test = (test_dir / f"Utest{class_name}.js").exists()
        rows.append(
            ParserAuditRow(
                parser_file=parser_file.name,
                class_name=class_name,
                base_class=base_class,
                hostnames=hostnames,
                direct_test=direct_test,
                has_get_chapter_urls="getChapterUrls(" in content,
                has_load_meta_info="loadEpubMetaInfo(" in content,
                has_find_chapter_title="findChapterTitle(" in content,
            )
        )
    return rows


def summarize(rows: list[ParserAuditRow], limit: int) -> str:
    total_parsers = len(rows)
    tested_parsers = sum(1 for row in rows if row.direct_test)
    total_hosts = sum(len(row.hostnames) for row in rows)
    base_counter = Counter(row.base_class for row in rows)
    tested_base_counter = Counter(row.base_class for row in rows if row.direct_test)

    lines = [
        f"Parsers: {total_parsers}",
        f"Registered hostnames: {total_hosts}",
        f"Parsers with direct parser tests: {tested_parsers}",
        f"Direct parser test coverage: {tested_parsers / total_parsers:.1%}",
        "",
        "Largest parser families:",
    ]

    for base_class, count in base_counter.most_common(limit):
        tested = tested_base_counter.get(base_class, 0)
        lines.append(
            f"  {base_class}: {count} parsers, {tested} direct tests ({tested / count:.1%})"
        )

    untested = [row for row in rows if not row.direct_test]
    lines.extend(
        [
            "",
            f"Untested parser files: {len(untested)}",
            "Highest-leverage untested families:",
        ]
    )

    untested_base_counter = Counter(row.base_class for row in untested)
    for base_class, count in untested_base_counter.most_common(limit):
        lines.append(f"  {base_class}: {count} untested parsers")

    lines.extend(
        [
            "",
            "Sample untested parsers:",
        ]
    )

    for row in untested[:limit]:
        hosts = ", ".join(row.hostnames[:3]) or "<no registrations found>"
        lines.append(f"  {row.class_name} [{row.base_class}] -> {hosts}")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    parser.add_argument("--limit", type=int, default=12, help="Rows to show in text summary")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    rows = build_rows(repo_root)

    if args.json:
        print(json.dumps([asdict(row) for row in rows], indent=2))
    else:
        print(summarize(rows, args.limit))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

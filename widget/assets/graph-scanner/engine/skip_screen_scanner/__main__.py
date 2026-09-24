from __future__ import annotations

import json
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
VENDORED = ENGINE.parent / "vendor" / "graphify"
sys.path.insert(0, str(VENDORED))

from scanner import scan_project  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: python __main__.py <diretório> [diretório-de-saída]", file=sys.stderr)
        return 2
    root = Path(sys.argv[1])
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    try:
        result = scan_project(root, output)
    except Exception as exc:
        print(f"Falha ao analisar o projeto: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

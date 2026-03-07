import importlib
import json
import sys


def load_module(name: str):
    return importlib.import_module(name)


def open_connection(module, path: str):
    if hasattr(module, "connect"):
        return module.connect(path)
    if hasattr(module, "open"):
        opened = module.open(path)
        if hasattr(opened, "connect"):
            return opened.connect()
        return opened
    raise RuntimeError(f"Unsupported seekdb Python module interface: {module!r}")


def run(payload: dict):
    module = load_module(payload.get("pythonModule", "seekdb"))
    connection = open_connection(module, payload["embeddedPath"])
    cursor = connection.cursor() if hasattr(connection, "cursor") else connection

    for statement in payload.get("statements", []):
        cursor.execute(statement)

    rows = []
    query = payload.get("query")
    if query:
        cursor.execute(query)
        fetched = cursor.fetchall() if hasattr(cursor, "fetchall") else []
        for row in fetched:
            if isinstance(row, (list, tuple)):
                rows.append(row[0] if row else "")
            else:
                rows.append(row)

    if hasattr(connection, "commit"):
        connection.commit()
    if hasattr(cursor, "close"):
        cursor.close()
    if hasattr(connection, "close"):
        connection.close()

    return {"ok": True, "rows": rows}


def main():
    try:
        payload = json.load(sys.stdin)
        result = run(payload)
        print(json.dumps(result))
    except Exception as exc:  # pragma: no cover - bridge safety path
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()

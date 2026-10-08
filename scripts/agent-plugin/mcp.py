#!/usr/bin/env python3
"""Local plugin tools. Execution and evidence semantics belong to the recorder."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "skills/codevetter-evaluate/scripts"))
from invoke import (AGENTS, OUTCOMES, REASONS, SKILLS, STATES, default_ledger,
                    invoke, list_invocations, now, write_metadata)
from outcomes import record_assessment
from telemetry import inspect_invocation

TEXT = {"type": "string", "minLength": 1, "maxLength": 2000}
UUID = {"type": "string", "format": "uuid"}
CORRELATION = {"task_id": UUID, "parent_id": UUID,
               "agent": {"type": "string", "enum": sorted(AGENTS)}}


def tool(name, description, properties, required, readonly=True):
    return {"name": name, "description": description,
            "inputSchema": {"type": "object", "additionalProperties": False,
                            "properties": properties, "required": required},
            "annotations": {"readOnlyHint": readonly, "destructiveHint": False,
                            "openWorldHint": False}}


TOOLS = [
    tool("discover_targets", "Discover testing or performance candidates without executing project code. Records a CLI invocation; relevance still needs inspection.",
         {"repo": TEXT, "consumer": {"type": "string", "enum": ["testing", "performance"]},
          "flow": TEXT, "change": TEXT, "codebase": {"type": "boolean"}, **CORRELATION},
         ["repo", "consumer", "task_id", "agent"], False),
    tool("plan_performance", "Plan an exact performance workload without running it. Not a measurement or correctness verdict; records a CLI invocation.",
         {"repo": TEXT, "adapter": {"type": "string", "enum": ["node-test", "node-script", "vitest", "playwright", "go-bench"]},
          "target": TEXT, "name": TEXT, **CORRELATION},
         ["repo", "adapter", "target", "task_id", "agent"], False),
    tool("list_invocations", "Paginated local recorder history, including failed and unassessed attempts. Does not count direct CLI/MCP/desktop activity outside the recorder.",
         {"repo": TEXT, "task_id": UUID, "skill": {"type": "string", "enum": sorted(SKILLS)},
          "state": {"type": "string", "enum": sorted(STATES)},
          "assessment": {"type": "string", "enum": sorted(OUTCOMES | {"unassessed"})},
          "offset": {"type": "integer", "minimum": 0},
          "limit": {"type": "integer", "minimum": 1, "maximum": 100}}, []),
    tool("inspect_invocation", "Read one invocation and hash-check its retained receipt, or inspect one JSON pointer. Includes source identity and assessment revisions.",
         {"invocation_id": UUID, "pointer": {"type": "string", "maxLength": 512}}, ["invocation_id"]),
    tool("assess_invocation", "Append an agent-reported helped/did_not_help/inconclusive/blocked observation. Help requires hash-bound receipt evidence; never establishes independent productivity.",
         {"invocation_id": UUID, "outcome": {"type": "string", "enum": sorted(OUTCOMES)},
          "reason": {"type": "string", "enum": sorted(REASONS)}, "summary": TEXT,
          "evidence_pointers": {"type": "array", "maxItems": 8, "uniqueItems": True,
                                "items": {"type": "string", "maxLength": 512}}},
         ["invocation_id", "outcome", "reason", "summary"], False),
]


def validate(args, schema):
    if not isinstance(args, dict) or set(args) - set(schema["properties"]):
        raise ValueError("Tool arguments must match the closed input schema")
    if set(schema["required"]) - set(args):
        raise ValueError("Missing required tool arguments")
    types = {"string": str, "boolean": bool, "integer": int, "array": list}
    for key, value in args.items():
        rule = schema["properties"][key]
        if type(value) is not types[rule["type"]]:
            raise ValueError("Wrong argument type")
        if "enum" in rule and value not in rule["enum"]:
            raise ValueError("Unsupported argument value")
        if isinstance(value, str) and (len(value) < rule.get("minLength", 0) or len(value) > rule.get("maxLength", 2000) or "\0" in value):
            raise ValueError("Invalid text argument")
        if type(value) is int and (value < rule.get("minimum", 0) or value > rule.get("maximum", 1000000)):
            raise ValueError("Argument outside bounds")
        if isinstance(value, list) and (len(value) > rule["maxItems"] or any(not isinstance(v, str) or len(v) > 512 for v in value)):
            raise ValueError("Invalid evidence pointers")


class Server:
    def __init__(self, ledger=None, cli="codevetter"):
        self.ledger = ledger if ledger is not None else default_ledger()
        self.cli = cli

    def call(self, name, args):
        definition = next((t for t in TOOLS if t["name"] == name), None)
        if definition is None:
            raise ValueError("Unknown tool")
        validate(args, definition["inputSchema"])
        if name == "list_invocations":
            values = dict(args)
            if "repo" in values:
                values["repo"] = Path(values["repo"])
            return list_invocations(self.ledger, **values)
        if name == "inspect_invocation":
            return inspect_invocation(self.ledger, args["invocation_id"], args.get("pointer"))
        if name == "assess_invocation":
            return record_assessment(self.ledger, args["invocation_id"], args["outcome"], args["reason"],
                                     args["summary"], args.get("evidence_pointers", []), now, write_metadata)
        if name == "discover_targets":
            selectors = [key for key in ("flow", "change", "codebase") if args.get(key)]
            if len(selectors) != 1:
                raise ValueError("Choose exactly one flow, change or true codebase selector")
            selector = selectors[0]
            command = ["scope", "--consumer", args["consumer"], "--" + selector]
            if selector != "codebase":
                if args[selector].startswith("-"):
                    raise ValueError("Selector cannot start with a flag")
                command.append(args[selector])
            skill = "codevetter-" + args["consumer"]
        else:
            target = Path(args["target"])
            repo = Path(args["repo"]).resolve(strict=True)
            if target.is_absolute() or ".." in target.parts or args["target"].startswith("-"):
                raise ValueError("Target must stay inside the repository")
            (repo / target).resolve(strict=True).relative_to(repo)
            command = ["performance", "--operation", "plan", "--adapter", args["adapter"], "--target", args["target"]]
            if "name" in args:
                if args["name"].startswith("-"):
                    raise ValueError("Workload name cannot start with a flag")
                command += ["--name", args["name"]]
            skill = "codevetter-performance"
        code, record, data = invoke(skill, Path(args["repo"]), command + ["--json"],
                                    self.ledger, self.cli, 60, args["task_id"],
                                    args.get("parent_id"), args["agent"])
        return {"invocation": record, "exit_code": code,
                "receipt": json.loads(data) if data else None,
                "limitations": ["Planning/discovery is not execution evidence or independent agent benefit.",
                                "Close this invocation with assess_invocation, including negative and blocked outcomes."]}

    def handle(self, request):
        if not isinstance(request, dict) or request.get("jsonrpc") != "2.0" or not isinstance(request.get("method"), str):
            return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}}
        if "id" not in request:
            return None
        method = request["method"]
        if method == "initialize":
            result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
                      "serverInfo": {"name": "codevetter-plugin", "version": "0.1.0"}}
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": TOOLS}
        elif method == "tools/call":
            try:
                params = request.get("params", {})
                value = self.call(params.get("name"), params.get("arguments", {}))
                failed = isinstance(value, dict) and value.get("exit_code", 0) != 0
                result = {"content": [{"type": "text", "text": json.dumps(value)}], "isError": failed}
            except (OSError, ValueError, KeyError, IndexError, TypeError, AttributeError):
                # Do not forward raw exception text containing paths or supplied arguments.
                result = {"content": [{"type": "text", "text": "Tool rejected invalid, unavailable or integrity-failing evidence. Check the input contract and retained invocation history."}], "isError": True}
        else:
            return {"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32601, "message": "Method not found"}}
        return {"jsonrpc": "2.0", "id": request["id"], "result": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger-dir", type=Path)
    parser.add_argument("--cli", default="codevetter")
    args = parser.parse_args()
    server = Server(args.ledger_dir, args.cli)
    while True:
        line = sys.stdin.buffer.readline(65537)
        if not line:
            return
        if len(line) > 65536:
            # Drain an oversized frame without parsing or retaining it.
            while line and not line.endswith(b"\n"):
                line = sys.stdin.buffer.readline(65537)
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Frame exceeds input bound"}}
        else:
            try:
                response = server.handle(json.loads(line))
            except (ValueError, UnicodeError, RecursionError):
                response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        if response is not None:
            print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()

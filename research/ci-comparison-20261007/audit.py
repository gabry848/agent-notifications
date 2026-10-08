"""Independently recompute paired summaries from the operators' preserved metrics."""
import json
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent


def read(path):
    return json.loads(path.read_text())


def raw_accounting(workload, run_id, reported):
    folder = "ci-development-20261007" if workload == "development" else "notes-mcp-ci-20261007"
    filename = "telemetry.jsonl" if workload == "development" else "trace.jsonl"
    path = ROOT / "research" / folder / "runs" / run_id / filename
    if not path.exists():
        return {"matches_reported": False, "all_attempts_metered": False,
                "reason": "Raw trace absent"}
    trace = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    usage_type = "raw_usage" if workload == "development" else "provider_usage"
    frames = {}
    for event in trace:
        usage = event.get("usage", {})
        if (event["type"] == usage_type and isinstance(usage.get("input_tokens"), (int, float))
                and isinstance(usage.get("output_tokens"), (int, float))):
            frames[event["responseId"]] = usage
    actual_http = sum(event["type"] == "http_attempt" for event in trace)
    actual_input = sum(frame["input_tokens"] for frame in frames.values())
    actual_output = sum(frame["output_tokens"] for frame in frames.values())
    return {"http": actual_http, "numeric_responses": len(frames),
            "input_tokens": actual_input, "output_tokens": actual_output,
            "matches_reported": actual_http == reported["http"]
                and actual_input + actual_output == reported["total_tokens"],
            "all_attempts_metered": actual_http == len(frames)}


def normalize(workload, row):
    if workload == "development":
        accounting = row["requests"]
        complete_usage = (
            row["usageReconciliation"]["passed"]
            and not accounting["unresolvedAttempts"]
            and accounting["http"] == accounting["settledResponses"]
        )
        return {
            "id": f'{row["stage"]}-{row["pair"]}-{row["mode"]}',
            "phase": row["stage"], "pair": row["pair"], "mode": row["mode"],
            "cohort": "frozen-development", "correct": row["correct"],
            "verified_ms": row["wallMs"], "http": accounting["http"],
            "total_tokens": row["tokens"]["input"] + row["tokens"]["output"],
            "complete_usage": complete_usage,
        }
    accounting = row["accounting"]
    return {
        "id": row["runId"], "phase": row["phase"], "pair": row["pair"],
        "mode": row["mode"], "cohort": row.get("protocolRevision", "unknown"),
        "manifest": row.get("inputManifestSha256"),
        "seed": row["seed"], "correct": row["correct"],
        "verified_ms": row["totalWallMs"], "http": row["httpAttempts"],
        "total_tokens": row.get("observedTotalTokens", row.get("totalTokens")),
        "complete_usage": (
            accounting["allRawPiMatched"]
            and accounting["httpAttempts"] == accounting["numericResponses"]
            and accounting["numericResponses"] == accounting["piAssistantResponses"]
        ),
    }


def summarize(workload, path):
    runs = [normalize(workload, r) for r in read(path)["runs"]]
    for run in runs:
        run["raw_accounting"] = raw_accounting(workload, run["id"], run)
        run["complete_usage"] = (run["complete_usage"]
            and run["raw_accounting"]["matches_reported"]
            and run["raw_accounting"]["all_attempts_metered"])
    measured = [r for r in runs if r["phase"] == "measured"]
    groups = {}
    for run in measured:
        key = (run["cohort"], run.get("manifest"), run["pair"], run.get("seed"))
        groups.setdefault(key, []).append(run)
    pairs = []
    for key, attempts in sorted(groups.items(), key=lambda x: str(x[0])):
        by_mode = {m: [r for r in attempts if r["mode"] == m] for m in ("PA", "N")}
        unique = all(len(v) == 1 for v in by_mode.values())
        eligible = (unique and all(r["correct"] for r in attempts)
                    and key[0] != "unknown"
                    and (workload != "notes" or key[1] is not None))
        pair = {"cohort": key[0], "manifest": key[1], "pair": key[2], "seed": key[3],
                "attempts": [r["id"] for r in attempts], "eligible": eligible}
        if unique:
            pa, n = by_mode["PA"][0], by_mode["N"][0]
            pair.update(PA=pa, N=n)
            pair["changes_percent"] = {}
            if eligible:
                for metric in ("verified_ms", "http", "total_tokens"):
                    usable = metric == "verified_ms" or (pa["complete_usage"] and n["complete_usage"])
                    pair["changes_percent"][metric] = (
                        100 * (n[metric] - pa[metric]) / pa[metric]
                        if usable and pa[metric] else None
                    )
        else:
            pair["reason"] = "Missing or duplicate mode attempts; no automatic selection"
        pairs.append(pair)
    stats = {}
    for metric in ("verified_ms", "http", "total_tokens"):
        values = [p["changes_percent"][metric] for p in pairs
                  if p["eligible"] and p["changes_percent"][metric] is not None]
        paired_values = {mode: [p[mode][metric] for p in pairs
                               if p["eligible"] and p["changes_percent"][metric] is not None]
                         for mode in ("PA", "N")}
        stats[metric] = {"n": len(values), "median_percent": median(values) if values else None,
                         "min_percent": min(values) if values else None,
                         "max_percent": max(values) if values else None,
                         "median_values": {m: median(v) if v else None
                                           for m, v in paired_values.items()}}
    return {"source": str(path.relative_to(ROOT)), "runs": runs, "pairs": pairs,
            "summary": stats, "correct_measured_runs": sum(r["correct"] for r in measured),
            "attempted_measured_runs": len(measured)}


results = {}
for workload, folder in (("development", "ci-development-20261007"),
                         ("notes", "notes-mcp-ci-20261007")):
    source = ROOT / "research" / folder / "metrics.json"
    if source.exists():
        results[workload] = summarize(workload, source)
output = {"formula": "100 * (notifications - polling) / polling, per complete correct pair",
          "aggregation": "Median paired percentage; workloads and calibration kept separate",
          "workloads": results}
(OUT / "paired-audit.json").write_text(json.dumps(output, indent=2) + "\n")
print(json.dumps({k: v["summary"] for k, v in results.items()}, indent=2))

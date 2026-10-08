"""Render the small overview; the operators retain the detailed evidence."""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
data = json.loads((BASE / "paired-audit.json").read_text())
labels = {"development": "Catalog CI", "notes": "Notes app"}
complete = set(data["workloads"]) == set(labels) and all(
    w["attempted_measured_runs"] == 10 for w in data["workloads"].values()
)
progress = "; ".join(
    f'{labels[key]}: {work["summary"]["verified_ms"]["n"]} correct pairs '
    f'({work["attempted_measured_runs"]}/10 measured runs)'
    for key, work in data["workloads"].items()
)
lines = ["# CI while Pi codes", "",
         "Pi implements useful features while real tests run against frozen code snapshots. "
         "We compare automatic results from Agent Notifications with adaptive batch polling.", "",
         "Final results." if complete else
         f"Interim results. {progress}. "
         "See the [continuation record](continuation-20261008.md) for pending work and release status.", "",
         "| Task | Correct matched pairs | Verified time | Model requests | Total tokens |",
         "|---|---:|---:|---:|---:|"]


def pct(value):
    return "—" if value is None else f"{value:+.1f}%"


def duration(value):
    if value is None:
        return "—"
    seconds = round(value / 1000)
    return f"{seconds // 60}m {seconds % 60:02d}s"


for key, work in data["workloads"].items():
    stats = work["summary"]
    values = [stats[k]["median_percent"] for k in ("verified_ms", "http", "total_tokens")]
    lines.append(f'| {labels[key]} | {stats["verified_ms"]["n"]} | '
                 + " | ".join(pct(v) for v in values) + " |")
lines += ["", "Changes are median paired percentages relative to polling: "
          "`100 × (notifications − polling) / polling`. Negative means less. "
          "Time includes final independent verification. Model requests are actual provider HTTP attempts; "
          "tokens count input (including cached tokens) plus output across those requests.", ""]

if complete:
    lines += ["CI outcomes reached the model earlier with notifications, but the complete-task "
              "effects are mixed. Catalog's median paired initial-result delivery delay fell "
              "94.6%; Notes' ten matched initial-job comparisons also all show earlier delivery. "
              "Notes has no actionable current-source failure at first exposure, so its stale "
              "failure messages do not establish faster bug correction. "
              "See the [Notes behavioral review](../notes-mcp-ci-20261007/final-behavior.md).", ""]

for key, work in data["workloads"].items():
    stats = work["summary"]["verified_ms"]
    lines += [f"**{labels[key]}**", "",
              f'{work["correct_measured_runs"]}/{work["attempted_measured_runs"]} measured runs pass '
              f'independent acceptance and required CI. Paired time change range: '
              f'{pct(stats["min_percent"])} to {pct(stats["max_percent"])}.', "",
              "| Pair | Polling | Notifications | Time change |",
              "|---|---:|---:|---:|"]
    for pair in work["pairs"]:
        pa, n = pair.get("PA", {}), pair.get("N", {})
        change = pair.get("changes_percent", {}).get("verified_ms")
        lines.append(f'| {pair["pair"]} | {duration(pa.get("verified_ms"))} | '
                     f'{duration(n.get("verified_ms"))} | {pct(change)} |')
    lines.append("")
lines += ["Both modes use Pi 0.99.2, gpt-6.1-sol with medium thinking, fresh workspaces, "
          "the same task/tools/instructions and declared CI queue delays. Real assertions decide "
          "success or failure. Mode order alternates; Pi workloads run sequentially. "
          "Calibration and unsuccessful/duplicate pairs remain visible in the detailed reports "
          "and are excluded from efficiency summaries.", "",
          "Earlier delivery of a result does not establish faster task completion. "
          "Failure reports already superseded by proactive edits are excluded from actionable "
          "failure-reaction comparisons. The protocol targets five pairs per task; "
          "even a completed five-pair cohort is exploratory evidence.", "",
          "Verified runs lasted roughly 4–7 minutes, below the intended 10–15-minute workload. "
          "Notes pair 1 ran on October 7; pairs 2–5 resumed on October 8 with the same frozen inputs "
          "and settings. Provider/time variability remains a limitation. "
          "See the [continuation record](continuation-20261008.md).", "",
          "[Catalog results](../ci-development-20261007/report.md) · "
          "[Notes results](../notes-mcp-ci-20261007/report.md) · "
          "[Independent paired/raw usage audit](paired-audit.json) · [Protocol](protocol.md)", ""]
(BASE / "report.md").write_text("\n".join(lines))
print("Final overview rendered" if complete else "Interim overview rendered")

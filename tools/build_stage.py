#!/usr/bin/env python3
# This script stages a preview of rels with verbs_resolved from the core verb lexicon and saves as stage for review.
import json, yaml, sys, os, datetime
from pathlib import Path
import argparse

def load_yaml(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def de_dupe_preserve_order(items):
    seen = set(); out = []
    for x in items or []:
        k = x.lower() if isinstance(x, str) else x
        if k not in seen:
            seen.add(k); out.append(x)
    return out

def main():
    parser = argparse.ArgumentParser(
        description="Stage a preview of rels with verbs_resolved from core lexicon (no seed merge)."
    )
    parser.add_argument("--base", default=None,
                        help="Base folder containing JBFragmentEngine-main/. If omitted, uses script parent.")
    parser.add_argument("--core", default="JBFragmentEngine-main/data/core_verb_lexicon.yaml",
                        help="Path to core_verb_lexicon.yaml (relative to --base or absolute).")
    parser.add_argument("--rels", default="JBFragmentEngine-main/data/rels_vocabulary.yaml",
                        help="Path to rels_vocabulary.yaml (relative to --base or absolute).")
    parser.add_argument("--outdir", default="dist/staged",
                        help="Output folder for staged preview artifacts.")
    parser.add_argument("--drop-verbs", action="store_true",
                        help="If set, drop original rels[].verbs (redundant) from staged preview.")
    args = parser.parse_args()

    # Resolve paths
    script_dir = Path(__file__).resolve().parent
    base = Path(args.base) if args.base else script_dir.parent
    core_path = Path(args.core)
    rels_path = Path(args.rels)
    if not core_path.is_absolute():
        core_path = base / core_path
    if not rels_path.is_absolute():
        rels_path = base / rels_path

    out_dir = Path(args.outdir)
    if not out_dir.is_absolute():
        out_dir = base / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    # --- Load YAMLs
    core = load_yaml(core_path) or {}
    rels_doc = load_yaml(rels_path) or {}
    rels_map = rels_doc.get("rels", {})
    if not isinstance(rels_map, dict):
        raise ValueError("rels_vocabulary.yaml must contain a top-level 'rels' mapping")

    # --- Index core verbs
    core_entries = core.get("verbs", []) or []
    core_index = {}
    all_core_tokens = set()
    for v in core_entries:
        vid = (v.get("id") or "").strip()
        if not vid:
            raise ValueError("Found a core verb without an 'id'.")
        synonyms = [s.strip() for s in (v.get("synonyms") or []) if s]
        v["synonyms"] = sorted(set(synonyms), key=str.lower)
        core_index[vid] = v
        all_core_tokens.add(vid.lower())
        for s in v["synonyms"]:
            all_core_tokens.add(s.lower())

    # --- Validate inverse targets existence
    valid_rel_ids = set(rels_map.keys())

    # --- Build staged rels (resolve verbs_resolved)
    staged_rels = []
    issues = {
        "invalid_lex_ref": [],
        "invalid_inverse_targets": [],
    }

    for rid, rel in sorted(rels_map.items(), key=lambda x: x[0].lower()):
        rel_copy = dict(rel)
        rel_copy["id"] = rel_copy.get("id") or rid
        lex_ref = (rel_copy.get("lex_ref") or "").strip()
        if not lex_ref or lex_ref not in core_index:
            issues["invalid_lex_ref"].append({"rel": rid, "lex_ref": lex_ref})
            # still continue to show in preview
            rel_copy["verbs_resolved"] = []
        else:
            lex = core_index[lex_ref]
            rel_copy["verbs_resolved"] = de_dupe_preserve_order([lex["id"]] + lex.get("synonyms", []))

        # Optional: drop legacy/duplicate verbs field
        if args.drop_verbs and "verbs" in rel_copy:
            rel_copy.pop("verbs", None)

        # Validate inverse_of targets
        inv = rel_copy.get("inverse_of")
        if isinstance(inv, list):
            for t in inv:
                if t not in valid_rel_ids:
                    issues["invalid_inverse_targets"].append({"rel": rid, "target": t})
        elif isinstance(inv, str):
            if inv.lower() != "null" and inv not in valid_rel_ids:
                issues["invalid_inverse_targets"].append({"rel": rid, "target": inv})

        staged_rels.append(rel_copy)

    # --- Prepare staged artifacts
    timestamp = datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds")
    summary = {
        "generated_at": timestamp,
        "core_file": str(core_path),
        "rels_file": str(rels_path),
        "rels_count": len(staged_rels),
        "verbs_count": len(core_entries),
        "issues": {k: len(v) for k, v in issues.items()}
    }

    # Write staged previews (no merge)
    with open(out_dir / "rels_resolved.preview.json", "w", encoding="utf-8") as f:
        json.dump({"rels": staged_rels, "summary": summary}, f, indent=2, ensure_ascii=False)

    with open(out_dir / "core_verb_lexicon.preview.json", "w", encoding="utf-8") as f:
        json.dump({"verbs": core_entries, "summary": summary}, f, indent=2, ensure_ascii=False)

    with open(out_dir / "stage_report.json", "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "issues_detail": issues}, f, indent=2, ensure_ascii=False)

    print("✅ Staged previews written to", out_dir.resolve())
    print(json.dumps(summary, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"❌ Staging failed: {e}", file=sys.stderr)
        sys.exit(1)

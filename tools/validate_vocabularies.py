#To execute run: python JBFragmentEngine-main/tools/validate_vocabularies.py --core JBFragmentEngine-main/data/core_verb_lexicon.yaml --rels JBFragmentEngine-main/data/rels_vocabulary.yaml

import argparse
import sys
import json
import yaml
from collections import defaultdict, Counter
from pathlib import Path

def load_yaml(path):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def main(core_path, rels_path):
    core_doc = load_yaml(core_path)
    rels_doc = load_yaml(rels_path)

    # Prepare core verb sets
    core_entries = core_doc.get("verbs", [])
    core_ids = set()
    core_terms_lower = set()
    id_to_terms = {}
    for v in core_entries:
        vid = v.get("id")
        if not vid:
            continue
        core_ids.add(vid)
        terms = [vid] + (v.get("synonyms", []) or [])
        id_to_terms[vid] = terms
        for t in terms:
            core_terms_lower.add(t.lower())

    # Prepare rels
    rels = rels_doc.get("rels", {})
    rel_ids = set(rels.keys())

    issues = {
        "missing_lex_ref_in_core": [],
        "invalid_inverse_targets": [],
        "empty_or_missing_fields": [],
    }

    # Validate each rel
    for rid, rel in rels.items():
        # Basic fields present (remove 'verbs' from required fields)
        for field in ("id", "description"):
            if field not in rel:
                issues["empty_or_missing_fields"].append({"rel": rid, "missing_field": field})

        # lex_ref check
        lex_ref = rel.get("lex_ref")
        if lex_ref and lex_ref not in core_ids:
            issues["missing_lex_ref_in_core"].append({"rel": rid, "lex_ref": lex_ref})

        # inverse_of targets exist
        inv = rel.get("inverse_of")
        if inv:
            if isinstance(inv, list):
                for target in inv:
                    if target not in rel_ids:
                        issues["invalid_inverse_targets"].append({"rel": rid, "target": target})
            elif isinstance(inv, str):
                if inv not in rel_ids and inv.lower() != "null":
                    issues["invalid_inverse_targets"].append({"rel": rid, "target": inv})

    # Prepare summary
    summary = {k: len(v) for k, v in issues.items()}
    clean = all(count == 0 for count in summary.values())
    result = {
        "core_file": str(core_path),
        "rels_file": str(rels_path),
        "summary": summary,
        "issues": issues,
        "status": "OK" if clean else "ISSUES_FOUND"
    }

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if clean else 1

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate core_verb_lexicon.yaml and rels_vocabulary.yaml")
    parser.add_argument("--core", default="core_verb_lexicon.yaml", help="Path to core_verb_lexicon.yaml")
    parser.add_argument("--rels", default="rels_vocabulary.yaml", help="Path to rels_vocabulary.yaml")
    args = parser.parse_args()

    core_path = Path(args.core)
    rels_path = Path(args.rels)
    sys.exit(main(core_path, rels_path))

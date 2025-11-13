import json
import yaml
from pathlib import Path

# Paths to source and target files
CORE_PATH = r"data/core_verb_lexicon.yaml"
RELS_PATH = r"data/rels_vocabulary.yaml"
SEED_PATH = r"data/seed-taxonomies.json"
MERGED_PATH = r"data/seed-taxonomies.merged.json"

# Load YAML file
def load_yaml(path):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

# Load JSON file
def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

# Save JSON file
def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# Main merge logic
def main():
    # Load source files
    core = load_yaml(CORE_PATH)
    rels = load_yaml(RELS_PATH)
    seed = load_json(SEED_PATH)

    # Prepare new keys
    verbs = core.get("verbs", [])
    rels_data = rels.get("rels", {})

    # Merge without losing original data
    merged = dict(seed)  # shallow copy
    merged["verbs"] = verbs
    merged["rels"] = rels_data

    # Save to new file
    save_json(MERGED_PATH, merged)
    print(f"Merged file written to {MERGED_PATH}")

if __name__ == "__main__":
    main()

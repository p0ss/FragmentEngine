#!/usr/bin/env python3
import yaml

# Read the YAML file
with open('data/core_verb_lexicon.yaml', 'r') as f:
    data = yaml.safe_load(f)

# Collect all primary terms and synonyms
primary_terms = set()
all_synonyms = []
synonym_to_primary = {}  # Maps synonym to which primary term(s) it belongs to

for verb in data['verbs']:
    primary = verb['id']
    primary_terms.add(primary)

    synonyms = verb.get('synonyms', [])
    for syn in synonyms:
        all_synonyms.append(syn)
        if syn not in synonym_to_primary:
            synonym_to_primary[syn] = []
        synonym_to_primary[syn].append(primary)

print("=" * 80)
print("DUPLICATE CHECK RESULTS")
print("=" * 80)
print()

# Check 1: Primary terms appearing as synonyms
print("1. PRIMARY TERMS APPEARING AS SYNONYMS:")
print("-" * 80)
overlaps = []
for primary in primary_terms:
    if primary in synonym_to_primary:
        overlaps.append((primary, synonym_to_primary[primary]))
        print(f"   ⚠️  '{primary}' is a primary term AND a synonym of: {', '.join(synonym_to_primary[primary])}")

if not overlaps:
    print("   ✓ No primary terms appear as synonyms")
print()

# Check 2: Synonyms appearing multiple times
print("2. SYNONYMS APPEARING IN MULTIPLE VERB ENTRIES:")
print("-" * 80)
duplicate_synonyms = []
for syn, primaries in synonym_to_primary.items():
    if len(primaries) > 1:
        duplicate_synonyms.append((syn, primaries))
        print(f"   ⚠️  '{syn}' appears as synonym for: {', '.join(primaries)}")

if not duplicate_synonyms:
    print("   ✓ No synonyms appear in multiple entries")
print()

# Check 3: Duplicate synonyms within the same entry
print("3. DUPLICATE SYNONYMS WITHIN SAME VERB ENTRY:")
print("-" * 80)
internal_duplicates = []
for verb in data['verbs']:
    synonyms = verb.get('synonyms', [])
    seen = set()
    duplicates_in_entry = []
    for syn in synonyms:
        if syn in seen:
            duplicates_in_entry.append(syn)
        seen.add(syn)

    if duplicates_in_entry:
        internal_duplicates.append((verb['id'], duplicates_in_entry))
        print(f"   ⚠️  '{verb['id']}' has duplicate synonyms: {', '.join(duplicates_in_entry)}")

if not internal_duplicates:
    print("   ✓ No duplicate synonyms within individual entries")
print()

# Summary
print("=" * 80)
print("SUMMARY")
print("=" * 80)
total_issues = len(overlaps) + len(duplicate_synonyms) + len(internal_duplicates)
print(f"Total primary terms: {len(primary_terms)}")
print(f"Total synonym entries: {len(all_synonyms)}")
print(f"Unique synonyms: {len(set(all_synonyms))}")
print(f"Total issues found: {total_issues}")

if total_issues > 0:
    print("\n⚠️  DUPLICATES FOUND - Action required!")
else:
    print("\n✓ No duplicates found - All terms are unique!")

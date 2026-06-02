import re
from generate_bank import load_vocab, VOCAB_XLSX, blank_example

entries = load_vocab(VOCAB_XLSX)
lookup = {e['word']: e for e in entries}

# Stopwords to filter out of definitions
STOPWORDS = {
    'a', 'an', 'the', 'to', 'of', 'in', 'for', 'with', 'or', 'and', 'is', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'but', 'as', 'by', 'at', 'from', 'about', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off',
    'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any',
    'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
    'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'someone', 'something', 'make',
    'makes', 'made', 'characterised', 'characterized', 'by', 'quality', 'state', 'feeling', 'express', 'expressing',
    'showing', 'show', 'cause', 'causing', 'relating', 'related', 'relative', 'person', 'people', 'who', 'which',
    'that', 'this', 'these', 'those', 'highly', 'extremely', 'very', 'marked', 'having', 'lacking', 'without',
    'difficult', 'easy', 'using', 'use', 'used', 'tendency', 'tend', 'tending', 'habit', 'habitual', 'process',
    'action', 'act', 'manner', 'way'
}

def clean_definition(definition):
    words = re.findall(r'[a-zA-Z]+', definition.lower())
    return {w for w in words if w not in STOPWORDS and len(w) > 2}

word_defs = {}
for e in entries:
    word_defs[e['word']] = clean_definition(e['definition'])

dynamic_pairs = []
for i in range(len(entries)):
    e1 = entries[i]
    w1 = e1['word']
    def1 = word_defs[w1]
    if not def1 or not (blank_example(e1, exact_only=True)):
        continue
        
    for j in range(i + 1, len(entries)):
        e2 = entries[j]
        w2 = e2['word']
        
        # Must be the same part of speech
        if e1['pos'] != e2['pos']:
            continue
            
        def2 = word_defs[w2]
        if not def2 or not (blank_example(e2, exact_only=True)):
            continue
            
        # Check direct cross-reference
        direct_ref = (w1 in def2) or (w2 in def1)
        
        # Check Jaccard similarity or substantial intersection of definitions
        intersection = def1.intersection(def2)
        jaccard = len(intersection) / len(def1.union(def2)) if def1.union(def2) else 0
        
        # We also check if they share a specific definition word and have overlap
        is_synonym = False
        if direct_ref:
            is_synonym = True
        elif jaccard >= 0.25:
            is_synonym = True
        elif len(intersection) >= 2 and (len(def1) <= 4 or len(def2) <= 4):
            is_synonym = True
        elif len(intersection) >= 3:
            is_synonym = True
            
        if is_synonym:
            dynamic_pairs.append((w1, w2))

# Deduplicate
deduped_dynamic = sorted(list(set(tuple(sorted(p)) for p in dynamic_pairs)))
print(f"Found {len(deduped_dynamic)} dynamic synonym pairs.")
for p in deduped_dynamic[:40]:
    w1, w2 = p[0], p[1]
    print(f"{w1} <-> {w2} | Def1: {lookup[w1]['definition']} | Def2: {lookup[w2]['definition']}")

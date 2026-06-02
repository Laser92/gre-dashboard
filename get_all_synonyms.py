import json
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from generate_bank import load_vocab, VOCAB_XLSX, blank_example

def fetch_synonyms(word):
    synonyms = set()
    # 1. Try rel_syn
    try:
        url_syn = f"https://api.datamuse.com/words?rel_syn={urllib.parse.quote(word)}"
        req = urllib.request.Request(url_syn, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            for item in data:
                synonyms.add(item['word'].lower())
    except Exception as e:
        pass

    # 2. Try ml (means like) and filter by 'syn' tag
    try:
        url_ml = f"https://api.datamuse.com/words?ml={urllib.parse.quote(word)}"
        req = urllib.request.Request(url_ml, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            for item in data:
                if 'tags' in item and 'syn' in item['tags']:
                    synonyms.add(item['word'].lower())
    except Exception as e:
        pass

    return word, synonyms

def main():
    entries = load_vocab(VOCAB_XLSX)
    lookup = {e['word']: e for e in entries}
    words = list(lookup.keys())
    print(f"Loaded {len(words)} words from vocab sheet.")

    pairs = set()
    completed = 0

    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(fetch_synonyms, w): w for w in words}
        for future in as_completed(futures):
            word, syns = future.result()
            completed += 1
            if completed % 100 == 0:
                print(f"Completed {completed}/{len(words)}...")

            for s in syns:
                if s in lookup and s != word:
                    # Same part of speech check
                    if lookup[word]['pos'] == lookup[s]['pos']:
                        # Sentence check
                        if blank_example(lookup[word], exact_only=False) or blank_example(lookup[s], exact_only=False):
                            pair = tuple(sorted([word, s]))
                            pairs.add(pair)

    sorted_pairs = sorted(list(pairs))
    print(f"Found {len(sorted_pairs)} synonym pairs in vocabulary list!")
    
    # Save the pairs to a text file
    with open("retrieved_synonyms.txt", "w", encoding="utf-8") as f:
        for p in sorted_pairs:
            f.write(f"{p[0]} {p[1]}\n")
    print("Wrote retrieved_synonyms.txt")

if __name__ == "__main__":
    main()

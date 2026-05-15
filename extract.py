import pandas as pd
import json

df = pd.read_excel('Magoosh 1000 Words.xlsx')
df = df.fillna('')
records = df[['word', 'definition', 'part of speech', 'example']].to_dict('records')

roots = {
    'mal': 'bad, evil', 'bene': 'good', 'dict': 'speak', 'spect': 'look', 'voc': 'call',
    'luc': 'light', 'lum': 'light', 'magn': 'great', 'min': 'small', 'morph': 'shape',
    'mut': 'change', 'omni': 'all', 'path': 'feeling', 'phil': 'love', 'phon': 'sound',
    'port': 'carry', 'rupt': 'break', 'scrib': 'write', 'script': 'write', 'sens': 'feel',
    'sent': 'feel', 'tract': 'pull', 'vac': 'empty', 'vid': 'see', 'vis': 'see',
    'chron': 'time', 'cred': 'believe', 'fac': 'make', 'graph': 'write', 'ject': 'throw',
    'log': 'word, reason', 'man': 'hand', 'mit': 'send', 'mort': 'death', 'ped': 'foot',
    'pod': 'foot', 'sect': 'cut', 'temp': 'time', 'tend': 'stretch', 'tens': 'stretch',
    'tent': 'stretch', 'ven': 'come', 'vent': 'come', 'vers': 'turn',
    'vert': 'turn', 'vok': 'call', 'volv': 'roll', 'volu': 'roll',
    'anthrop': 'human', 'auto': 'self', 'bio': 'life', 'dys': 'bad', 'eu': 'good',
    'hetero': 'different', 'homo': 'same', 'hyper': 'over', 'hypo': 'under', 'macro': 'large',
    'micro': 'small', 'mono': 'one', 'pan': 'all', 'poly': 'many', 'tele': 'far',
    'therm': 'heat', 'aberr': 'wander away', 'ambi': 'both'
}

# sort roots by length descending to match longest first
roots = dict(sorted(roots.items(), key=lambda item: len(item[0]), reverse=True))

for r in records:
    w = str(r['word']).lower()
    r['root'] = ''
    for k, v in roots.items():
        if k in w and len(w) > len(k) + 1:
            r['root'] = f"{k} ({v})"
            break

with open('public/flashcards.json', 'w', encoding='utf-8') as f:
    json.dump(records, f)

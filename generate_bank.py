import json
import gzip
import random
import re
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile


RANDOM_SEED = 1701
VOCAB_XLSX = Path(r"C:/Users/avikr/Downloads/Magoosh 1000 Words.xlsx")
PUBLIC_BANK_PATH = Path("public/questions_bank.js")
PUBLIC_BANK_GZIP_PATH = Path("public/questions_bank.js.gz")
JSON_BANK_PATH = Path("questions.json")

SHEET_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

SE_PAIR_CANDIDATES = """
aberrant anomalous
abstruse recondite
admonish rebuke
advocate proponent
affable amiable
ameliorate mitigate
anodyne innocuous
apathy indifference
appease placate
artless ingenuous
ascetic austere
audacious intrepid
avarice cupidity
banal hackneyed
belligerent truculent
benign innocuous
bolster buttress
capricious fickle
castigate chastise
censure rebuke
deleterious pernicious
ephemeral transient
equivocate prevaricate
esoteric arcane
fastidious meticulous
hackneyed trite
impetuous rash
implacable inexorable
intransigent uncompromising
opaque obscure
precipitate rash
prosaic mundane
rarefied esoteric
scrupulous meticulous
taciturn reticent
tractable malleable
trenchant incisive
vindicate exonerate
""".strip().splitlines()

HARD_RC_PASSAGES = [
    {
        "passage": (
            "Some critics treat scientific consensus as a monolith, but that caricature obscures the provisional "
            "and often contentious nature of research. A mature consensus is not a refusal to reconsider evidence; "
            "rather, it is the result of repeated attempts to dislodge a claim that have, so far, failed. The public "
            "debate becomes distorted when every dissenting paper is portrayed as a revolution and every correction "
            "as a collapse of the field."
        ),
        "questions": [
            {
                "text": "The passage suggests that a mature scientific consensus is best understood as:",
                "options": [
                    "a claim protected from criticism by institutional authority.",
                    "a position that has survived sustained efforts at refutation.",
                    "a compromise adopted to avoid public disagreement.",
                    "a conclusion that can no longer be modified by later evidence.",
                    "a rhetorical strategy used to marginalize dissenting scholars."
                ],
                "answer": 1,
                "explanation": "The author says mature consensus comes from repeated failed attempts to dislodge a claim, not from immunity to criticism."
            },
            {
                "text": "The author would most likely regard the public treatment of every dissenting paper as a revolution as:",
                "options": [
                    "a useful corrective to excessive academic caution.",
                    "a necessary stage in the validation of novel hypotheses.",
                    "a distortion that exaggerates ordinary scholarly disagreement.",
                    "an indication that consensus has become intellectually inert.",
                    "a sign that scientific fields advance chiefly through abrupt reversals."
                ],
                "answer": 2,
                "explanation": "The final sentence calls this framing distorted because it mistakes routine dissent and correction for wholesale upheaval."
            }
        ]
    },
    {
        "passage": (
            "The historian's task is complicated by the fact that archives rarely preserve the ordinary in proportion "
            "to its prevalence. Bureaucracies record disputes, crises, and infractions more assiduously than routine "
            "compliance. Consequently, a society reconstructed only from official complaints can appear more fractious "
            "than it was, while the habits that made daily life possible remain nearly invisible."
        ),
        "questions": [
            {
                "text": "The passage primarily warns that archival evidence may:",
                "options": [
                    "overrepresent disruptions while underrepresenting routine behavior.",
                    "make bureaucracies seem less intrusive than they actually were.",
                    "provide unreliable dates for otherwise well-attested events.",
                    "privilege private letters over official documents.",
                    "erase the role of elites in shaping public institutions."
                ],
                "answer": 0,
                "explanation": "The author emphasizes that records preserve disputes and infractions more readily than ordinary compliance."
            },
            {
                "text": "In context, 'fractious' most nearly means:",
                "options": [
                    "prosperous",
                    "rebellious",
                    "insular",
                    "methodical",
                    "ceremonial"
                ],
                "answer": 1,
                "explanation": "A complaint-heavy archive can make a society seem more quarrelsome or rebellious than it really was."
            }
        ]
    }
]

MULTI_BLANK_TEMPLATES = [
    {
        "text": "Although the mayor insisted that the contract was (1) ________, auditors later discovered a pattern of (2) ________ that made the deal impossible to defend.",
        "answers": ["aboveboard", "subterfuge"]
    },
    {
        "text": "The professor's explanation was intended to be (1) ________, but its jargon made the lecture almost (2) ________ to first-year students.",
        "answers": ["pellucid", "abstruse"]
    },
    {
        "text": "The candidate tried to (1) ________ the controversy, but his evasive answers only served to (2) ________ public suspicion.",
        "answers": ["appease", "exacerbate"]
    },
    {
        "text": "Because the witness had been so (1) ________ in earlier testimony, the jury doubted that his latest account was (2) ________.",
        "answers": ["equivocal", "veracious"]
    },
    {
        "text": "The committee first praised the proposal as (1) ________, then rejected it as (2) ________ once its hidden costs became clear.",
        "answers": ["creditable", "deleterious"]
    },
    {
        "text": "Rather than offer a (1) ________ critique, the reviewer wrote a (2) ________ attack that ignored the book's real argument.",
        "answers": ["dispassionate", "vitriolic"]
    },
    {
        "text": "Her apology sounded (1) ________, but the documents revealed the (2) ________ behind her effort to mislead the board.",
        "answers": ["contrite", "mendacity"]
    },
    {
        "text": "The artist's early work was dismissed as (1) ________, yet later critics found its symbolism surprisingly (2) ________.",
        "answers": ["prosaic", "recondite"]
    },
    {
        "text": "Although the CEO presented herself as (1) ________, former employees described a manager who was (2) ________ and unwilling to compromise.",
        "answers": ["amenable", "intransigent"]
    },
    {
        "text": "The historian's style is (1) ________ rather than ornate, but the argument is anything but (2) ________.",
        "answers": ["laconic", "banal"]
    },
    {
        "text": "The senator tried to (1) ________ the report's conclusions, but the new evidence seemed to (2) ________ them.",
        "answers": ["undermine", "vindicate"]
    },
    {
        "text": "The negotiations began in a (1) ________ spirit, grew (2) ________ after the first insult, and finally ended in open (3) ________.",
        "answers": ["conciliate", "truculent", "animosity"]
    },
    {
        "text": "The editor found the manuscript (1) ________ in style, (2) ________ in argument, and marred by a final chapter full of (3) ________.",
        "answers": ["lucid", "cogent", "prolixity"]
    },
    {
        "text": "Although the experiment looked (1) ________, its methods were (2) ________, and the resulting claims were therefore (3) ________.",
        "answers": ["auspicious", "imprudent", "spurious"]
    },
    {
        "text": "The director was neither (1) ________ nor reckless: she was (2) ________ with funds and never (3) ________ in her long-term planning.",
        "answers": ["prodigal", "parsimonious", "imprudent"]
    },
    {
        "text": "His public manner was (1) ________, his private emails were (2) ________, and the contrast exposed the (3) ________ of his persona.",
        "answers": ["affable", "vitriolic", "duplicity"]
    }
]


def read_xlsx_rows(path):
    with ZipFile(path) as archive:
        shared_strings = []
        shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        for item in shared_root.findall("a:si", SHEET_NS):
            shared_strings.append("".join(t.text or "" for t in item.findall(".//a:t", SHEET_NS)))

        sheet_root = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        rows = []
        for row in sheet_root.findall(".//a:sheetData/a:row", SHEET_NS):
            values = {}
            for cell in row.findall("a:c", SHEET_NS):
                ref = cell.attrib.get("r", "")
                column = "".join(ch for ch in ref if ch.isalpha())
                raw = cell.find("a:v", SHEET_NS)
                if raw is None:
                    continue
                value = raw.text or ""
                if cell.attrib.get("t") == "s":
                    value = shared_strings[int(value)]
                values[column] = value.strip()
            rows.append(values)
    return rows


def load_vocab(path):
    entries = []
    for row in read_xlsx_rows(path)[1:]:
        word = clean_cell(row.get("B", "")).lower()
        definition = clean_cell(row.get("C", ""))
        part_of_speech = clean_cell(row.get("D", "")).lower()
        example = clean_cell(row.get("E", ""))
        if word and definition and part_of_speech:
            entries.append({
                "word": word,
                "definition": definition.rstrip("."),
                "pos": part_of_speech,
                "example": example
            })
    return entries


def clean_cell(value):
    return re.sub(r"\s+", " ", value or "").strip()


def clue_text(definition):
    text = re.split(r"[.;]", definition, maxsplit=1)[0]
    text = re.sub(r"\([^)]*\)", "", text)
    text = text.replace("esp.", "especially")
    return text.strip().rstrip(",") or definition


def word_forms(word):
    base = word.lower()
    forms = {
        base, f"{base}s", f"{base}es", f"{base}ed", f"{base}d",
        f"{base}ing", f"{base}ly"
    }
    if base.endswith("e"):
        forms.add(f"{base[:-1]}ing")
    if base.endswith("y"):
        forms.add(f"{base[:-1]}ies")
        forms.add(f"{base[:-1]}ily")
    return sorted(forms, key=len, reverse=True)


def blank_example(entry, exact_only=False):
    example = entry["example"]
    if not example:
        return None
    forms = [entry["word"]] if exact_only else word_forms(entry["word"])
    for form in forms:
        pattern = re.compile(rf"\b{re.escape(form)}\b", re.IGNORECASE)
        for sentence in split_sentences(example):
            if pattern.search(sentence):
                return pattern.sub("________", sentence, count=1)
    return None


def split_sentences(text):
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    return sentences or [text]


def entries_by_pos(entries):
    grouped = {}
    for entry in entries:
        grouped.setdefault(entry["pos"], []).append(entry)
    return grouped


def choose_distractors(entry, grouped, count, excluded=None):
    excluded = set(excluded or [])
    excluded.add(entry["word"])
    same_pos = [
        candidate for candidate in grouped.get(entry["pos"], [])
        if candidate["word"] not in excluded
    ]
    same_pos.sort(key=lambda candidate: (
        abs(len(candidate["word"]) - len(entry["word"])),
        random.random()
    ))
    picks = same_pos[:count]
    if len(picks) < count:
        fallback = [
            candidate for bucket in grouped.values() for candidate in bucket
            if candidate["word"] not in excluded and candidate not in picks
        ]
        random.shuffle(fallback)
        picks.extend(fallback[:count - len(picks)])
    return [pick["word"] for pick in picks]


def make_tc_question(q_id, entry, grouped):
    sentence = blank_example(entry, exact_only=True) or (
        f"The context requires a {entry['pos']} meaning '{entry['definition']}': the best answer is ________."
    )
    options = [entry["word"], *choose_distractors(entry, grouped, 4)]
    random.shuffle(options)
    return {
        "id": q_id,
        "passage": None,
        "text": f"Question {q_id}: {sentence}",
        "options": options,
        "answer": options.index(entry["word"]),
        "explanation": f"'{entry['word']}' means {entry['definition']}."
    }


def make_se_question(q_id, pair, lookup, grouped):
    first = lookup[pair[0]]
    second = lookup[pair[1]]
    first_sentence = blank_example(first, exact_only=True)
    second_sentence = blank_example(second, exact_only=True)
    sentence = first_sentence or second_sentence
    source = first if first_sentence else second
    distractors = choose_distractors(source, grouped, 4, excluded={first["word"], second["word"]})
    options = [first["word"], second["word"], *distractors]
    random.shuffle(options)
    answers = sorted([options.index(first["word"]), options.index(second["word"])])
    return {
        "id": q_id,
        "passage": None,
        "text": f"SE Question {q_id}: {sentence}",
        "options": options,
        "answer": answers[0],
        "answers": answers,
        "explanation": (
            f"'{first['word']}' and '{second['word']}' form the correct pair. "
            f"'{first['word']}' means {first['definition']}; '{second['word']}' means {second['definition']}."
        )
    }


def make_multi_blank_question(q_id, lookup, grouped):
    template = MULTI_BLANK_TEMPLATES[(q_id - 1) % len(MULTI_BLANK_TEMPLATES)]
    selected = [lookup[word] for word in template["answers"]]
    text = f"SC Question {q_id}: {template['text']}"

    option_groups = []
    answers = []
    explanations = []
    for entry in selected:
        options = [entry["word"], *choose_distractors(entry, grouped, 2, excluded={e["word"] for e in selected if e != entry})]
        random.shuffle(options)
        option_groups.append(options)
        answers.append(options.index(entry["word"]))
        explanations.append(f"Blank {len(explanations) + 1}: '{entry['word']}' means {entry['definition']}.")

    return {
        "id": q_id,
        "passage": None,
        "text": text,
        "options": option_groups,
        "answer": answers,
        "answers": answers,
        "explanation": " ".join(explanations)
    }


def make_rc_questions():
    questions = []
    q_id = 1
    while len(questions) < 300:
        for passage_set in HARD_RC_PASSAGES:
            for source in passage_set["questions"]:
                q = deepcopy(source)
                q["id"] = q_id
                q["passage"] = passage_set["passage"]
                q["text"] = f"RC Question {q_id}: {q['text']}"
                correct_text = q["options"][q["answer"]]
                random.shuffle(q["options"])
                q["answer"] = q["options"].index(correct_text)
                questions.append(q)
                q_id += 1
                if len(questions) == 300:
                    return questions
    return questions


def build_bank(entries):
    random.seed(RANDOM_SEED)
    grouped = entries_by_pos(entries)
    lookup = {entry["word"]: entry for entry in entries}
    blankable = [entry for entry in entries if blank_example(entry, exact_only=True)]
    random.shuffle(blankable)

    pair_words = []
    for row in SE_PAIR_CANDIDATES:
        first, second = row.split()
        if (
            first in lookup and second in lookup
            and (blank_example(lookup[first], exact_only=True) or blank_example(lookup[second], exact_only=True))
        ):
            pair_words.append((first, second))
    random.shuffle(pair_words)

    tc_list = [
        make_tc_question(i + 1, blankable[i % len(blankable)], grouped)
        for i in range(300)
    ]
    se_list = [
        make_se_question(i + 1, pair_words[i % len(pair_words)], lookup, grouped)
        for i in range(300)
    ]
    mb_list = [
        make_multi_blank_question(i + 1, lookup, grouped)
        for i in range(300)
    ]
    rc_list = make_rc_questions()

    diagnostic = []
    for i in range(300):
        source = [tc_list, se_list, rc_list][i % 3][i]
        q = deepcopy(source)
        q["id"] = i + 1
        diagnostic.append(q)

    return {"1": diagnostic, "3": tc_list, "4": se_list, "5": rc_list, "6": mb_list}


def main():
    if not VOCAB_XLSX.exists():
        raise FileNotFoundError(f"Vocabulary workbook not found: {VOCAB_XLSX}")
    entries = load_vocab(VOCAB_XLSX)
    bank = build_bank(entries)

    PUBLIC_BANK_PATH.write_text(
        "window.QUESTION_BANK = " + json.dumps(bank, indent=2, ensure_ascii=False) + ";\n",
        encoding="utf-8"
    )
    PUBLIC_BANK_GZIP_PATH.write_bytes(gzip.compress(PUBLIC_BANK_PATH.read_bytes(), compresslevel=9))
    JSON_BANK_PATH.write_text(json.dumps(bank, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Generated {sum(len(v) for v in bank.values())} questions from {len(entries)} Magoosh words.")
    print(f"Wrote {PUBLIC_BANK_PATH}, {PUBLIC_BANK_GZIP_PATH}, and {JSON_BANK_PATH}.")


if __name__ == "__main__":
    main()

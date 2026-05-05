import json
import random

# ==========================================
# 1. HAND-CRAFTED PREMIUM QUESTIONS
# ==========================================

premium_text_completions = [
    {
        "passage": None,
        "text": "The politician’s seemingly innocuous proposal was, upon closer inspection by legal scholars, revealed to be entirely ________, designed to slowly strip away environmental protections under the guise of bureaucratic streamlining.",
        "options": ["salutary", "pernicious", "ineffectual", "transparent", "mercurial"],
        "answer": 1,
        "explanation": "The proposal was 'seemingly innocuous' (harmless), but actually 'designed to slowly strip away' protections. The blank must contrast with innocuous and describe something harmful that is hidden. 'Pernicious' means having a harmful effect, especially in a gradual or subtle way."
    },
    {
        "passage": None,
        "text": "Far from being the ________ history it purported to be, the biography was rife with ad hominem attacks and unsubstantiated rumors, revealing more about the author's vendettas than the subject's life.",
        "options": ["dispassionate", "tendentious", "provocative", "exhaustive", "frivolous"],
        "answer": 0,
        "explanation": "The phrase 'Far from being' indicates the biography lacked the quality in the blank. It was full of 'ad hominem attacks' and 'vendettas', meaning it was highly biased. Therefore, it claimed to be unbiased. 'Dispassionate' means not influenced by strong emotion, and thus able to be rational and impartial."
    },
    {
        "passage": None,
        "text": "The committee’s refusal to modify their ________ stance on the zoning regulations ultimately stalled the development project for a decade, much to the chagrin of the city planners.",
        "options": ["capitulating", "obdurate", "magnanimous", "provisional", "vacillating"],
        "answer": 1,
        "explanation": "The committee exhibited a 'refusal to modify' their stance, which stalled the project. The blank must mean stubborn or unyielding. 'Obdurate' means stubbornly refusing to change one's opinion or course of action."
    },
    {
        "passage": None,
        "text": "Although the novel’s plot was remarkably conventional, its prose was highly ________, characterized by arcane vocabulary, labyrinthine syntax, and obscure historical allusions.",
        "options": ["pellucid", "prosaic", "recondite", "hackneyed", "luculent"],
        "answer": 2,
        "explanation": "The blank describes prose characterized by 'arcane vocabulary, labyrinthine syntax, and obscure historical allusions' (difficult to understand). 'Recondite' means little known or abstruse; obscure."
    },
    {
        "passage": None,
        "text": "Her approach to the diplomatic crisis was anything but ________; instead of seeking immediate consensus, she meticulously orchestrated a series of escalating economic pressures to force the opposition's hand.",
        "options": ["calculated", "precipitate", "strategic", "inexorable", "circuitous"],
        "answer": 1,
        "explanation": "The phrase 'anything but' means she was NOT the word in the blank. Instead, she 'meticulously orchestrated' a plan, meaning she was careful and deliberate. Therefore, she was NOT hasty. 'Precipitate' means done, made, or acting suddenly or without careful consideration."
    }
]

premium_sentence_equivalence = [
    {
        "passage": None,
        "text": "SE Question: Which word best completes the sentence? Despite the ______ of resources available to the research team, their ingenuity allowed them to synthesize a groundbreaking new polymer.",
        "options": ["paucity", "surfeit", "plethora", "myriad", "abundance"],
        "answer": 0,
        "explanation": "'Despite' sets up a contrast with 'ingenuity allowed them to synthesize'. This implies they lacked resources. 'Paucity' means the presence of something only in small or insufficient quantities or amounts; scarcity."
    },
    {
        "passage": None,
        "text": "SE Question: Which word best completes the sentence? The critic dismissed the young artist's latest exhibition as mere ________, arguing that it relied entirely on shocking the audience rather than demonstrating any genuine technical mastery.",
        "options": ["chicanery", "virtuosity", "profundity", "verisimilitude", "aesthetics"],
        "answer": 0,
        "explanation": "The critic dismissed the art, claiming it relied on 'shocking the audience' rather than 'technical mastery'. The blank must be a negative word for trickery or cheap tactics. 'Chicanery' means the use of trickery to achieve a political, financial, or legal purpose."
    },
    {
        "passage": None,
        "text": "SE Question: Which word best completes the sentence? Long viewed as a marginalized sect, the group's philosophical tenets eventually became so ________ that they formed the foundation of the nation's new constitutional framework.",
        "options": ["esoteric", "hegemonic", "subversive", "anachronistic", "transient"],
        "answer": 1,
        "explanation": "The group transitioned from being 'marginalized' (outsiders) to forming the 'foundation of the nation's new constitutional framework' (dominant power). 'Hegemonic' means ruling or dominant in a political or social context."
    }
]

premium_reading_comp = [
    {
        "passage": "In historiography, the 'Great Man' theory posits that history is largely explained by the impact of highly influential individuals. However, the Annales School, emerging in 20th-century France, vehemently opposed this framework. Instead, Annales historians emphasized the role of 'la longue durée' (the long term)—focusing on slow-moving geographical, economic, and demographic forces over centuries. They argued that individual rulers are merely the crests of waves on a much deeper, more powerful ocean of systemic historical trends.",
        "text": "According to the passage, the Annales School would most likely view the reign of a famous conquering emperor as:",
        "options": [
            "The primary catalyst for subsequent economic and demographic shifts.",
            "A superficial phenomenon driven by underlying, long-term systemic forces.",
            "A direct refutation of the 'la longue durée' historical framework.",
            "The most critical subject of study for understanding 20th-century France.",
            "An anomaly that cannot be explained by geographical or economic trends."
        ],
        "answer": 1,
        "explanation": "The Annales School argues that 'individual rulers are merely the crests of waves on a much deeper, more powerful ocean of systemic historical trends.' This metaphorical language implies that individual actions are superficial compared to long-term systemic forces."
    },
    {
        "passage": "In historiography, the 'Great Man' theory posits that history is largely explained by the impact of highly influential individuals. However, the Annales School, emerging in 20th-century France, vehemently opposed this framework. Instead, Annales historians emphasized the role of 'la longue durée' (the long term)—focusing on slow-moving geographical, economic, and demographic forces over centuries. They argued that individual rulers are merely the crests of waves on a much deeper, more powerful ocean of systemic historical trends.",
        "text": "The author uses the metaphor of 'crests of waves' primarily to:",
        "options": [
            "Illustrate the destructive power of geographical and climatic events.",
            "Highlight the unpredictability of demographic shifts over centuries.",
            "Contrast the superficial visibility of individuals with the profound power of systemic trends.",
            "Argue that history is cyclical and prone to repeating itself in waves.",
            "Demonstrate that the 'Great Man' theory is completely devoid of any historical value."
        ],
        "answer": 2,
        "explanation": "The metaphor contrasts the highly visible but ultimately superficial 'crests of waves' (individual rulers) with the 'much deeper, more powerful ocean' (systemic historical trends), perfectly illustrating the Annales School's perspective."
    }
]

# ==========================================
# 2. ADVANCED PROGRAMMATIC GENERATION
# ==========================================

advanced_vocab_templates = [
    ("vitiate", "spoil or impair", "bolster", "The integrity of the scientific study was entirely {blank}d when it was revealed that the lead researcher had financial ties to the pharmaceutical company."),
    ("calumny", "slander", "praise", "The political campaign devolved into a mire of {blank}, with both candidates prioritizing baseless character assassination over policy debate."),
    ("polemic", "strong verbal or written attack", "panegyric", "Rather than offering a balanced review of the literature, the academic's new book was a fiery {blank} against modern architectural trends."),
    ("truculent", "eager or quick to argue or fight", "conciliatory", "The union representative's {blank} demeanor during negotiations alienated the mediators and ensured that a strike was inevitable."),
    ("spurious", "false or fake", "authentic", "The historian dedicated her career to debunking {blank} documents that had long been accepted as factual records of the medieval era."),
    ("chicanery", "trickery", "probity", "The corporate executive was convicted not of outright theft, but of a complex web of financial {blank} designed to mislead shareholders."),
    ("apocryphal", "of doubtful authenticity", "verified", "Though widely circulated on the internet, the quote attributed to Albert Einstein is entirely {blank}."),
    ("obdurate", "stubborn", "malleable", "Despite impassioned pleas from his constituents, the mayor remained {blank} in his decision to bulldoze the historic park."),
    ("esoteric", "understood by few", "accessible", "The programming language was so {blank} that only a few dozen software engineers worldwide could write functional code in it."),
    ("alacrity", "brisk and cheerful readiness", "lethargy", "Having trained for the marathon for six months, she accepted the challenge with surprising {blank}."),
    ("equivocate", "use ambiguous language to conceal truth", "clarify", "When pressed on whether he would raise taxes, the governor continued to {blank}, leaving voters frustrated by his lack of a direct answer.")
]

def generate_hard_tc(q_id):
    word, meaning, ant, sentence = random.choice(advanced_vocab_templates)
    options = [word, ant, "ambiguous", "superfluous", "ephemeral"]
    random.shuffle(options)
    answer_idx = options.index(word)
    text = sentence.replace("{blank}", "________")
    
    return {
        "id": q_id,
        "passage": None,
        "text": f"Question {q_id}: {text}",
        "options": options,
        "answer": answer_idx,
        "explanation": f"The correct answer is '{word}'. The context requires a word meaning '{meaning}'. The word '{word}' fits perfectly."
    }

def generate_hard_se(q_id):
    word, meaning, ant, sentence = random.choice(advanced_vocab_templates)
    options = [word, ant, "transient", "prosaic", "didactic"]
    random.shuffle(options)
    answer_idx = options.index(word)
    text = sentence.replace("{blank}", "________")
    
    return {
        "id": q_id,
        "passage": None,
        "text": f"SE Question {q_id}: Which word best completes the sentence? {text}",
        "options": options,
        "answer": answer_idx,
        "explanation": f"The correct answer is '{word}' (meaning '{meaning}'). In Sentence Equivalence, look for words that maintain the sentence's contextual integrity."
    }

# ==========================================
# 3. BUILD THE HYBRID BANK
# ==========================================

questions_bank = {
    "1": [], "3": [], "4": [], "5": []
}

# Fill Text Completions (Chapter 3)
tc_list = [dict(q, id=i+1) for i, q in enumerate(premium_text_completions)]
start_idx = len(tc_list) + 1
for i in range(start_idx, 301):
    tc_list.append(generate_hard_tc(i))
questions_bank["3"] = tc_list

# Fill Sentence Equivalence (Chapter 4)
se_list = [dict(q, id=i+1) for i, q in enumerate(premium_sentence_equivalence)]
start_idx = len(se_list) + 1
for i in range(start_idx, 301):
    se_list.append(generate_hard_se(i))
questions_bank["4"] = se_list

# Fill Reading Comp (Chapter 5)
rc_list = [dict(q, id=i+1) for i, q in enumerate(premium_reading_comp)]
# Just repeat premium RCs with slight option shuffling for the rest to simulate dense reading
start_idx = len(rc_list) + 1
for i in range(start_idx, 301):
    q = dict(random.choice(premium_reading_comp))
    q["id"] = i
    q["text"] = f"RC Question {i}: {q['text']}"
    opts = q["options"].copy()
    correct_text = opts[q["answer"]]
    random.shuffle(opts)
    q["options"] = opts
    q["answer"] = opts.index(correct_text)
    rc_list.append(q)
questions_bank["5"] = rc_list

# Fill Diagnostic (Chapter 1)
# Mix the first 10 of TC, SE, RC
diag_list = []
for i in range(1, 301):
    if i % 3 == 0:
        diag_list.append(dict(tc_list[i % len(tc_list)], id=i))
    elif i % 3 == 1:
        diag_list.append(dict(se_list[i % len(se_list)], id=i))
    else:
        diag_list.append(dict(rc_list[i % len(rc_list)], id=i))
questions_bank["1"] = diag_list

with open("questions_bank.js", "w", encoding="utf-8") as f:
    f.write("window.QUESTION_BANK = " + json.dumps(questions_bank, indent=2) + ";\n")

print("Successfully generated 1200 hybrid questions into questions_bank.js")

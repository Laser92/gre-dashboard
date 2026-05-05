import json
import re

def parse_questions(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    questions = {}
    current_chapter = None
    current_q = None
    current_options = []
    
    chapter_pattern = re.compile(r'(Chapter\s+\d+|Verbal Diagnostic Test|Math Diagnostic Test|Text Completions|Sentence Equivalence|Reading Comprehension)')
    q_start_pattern = re.compile(r'^(\d+)\.\s*$')
    option_pattern = re.compile(r'^\([A-E]\)|^[a-z]+\s*$') # basic heuristic
    
    chapter_map = {
        'Verbal Diagnostic Test': 1,
        'Math Diagnostic Test': 2,
        'Text Completions': 3,
        'Sentence Equivalence': 4,
        'Reading Comprehension': 5
    }
    
    chapter_id = 1
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Try to detect chapter changes loosely
        if 'Diagnostic Test' in line or 'Chapter' in line:
            for k, v in chapter_map.items():
                if k in line:
                    chapter_id = v
                    if chapter_id not in questions:
                        questions[chapter_id] = []
                    break
        
        match = q_start_pattern.match(line)
        if match:
            # save previous
            if current_q and current_q['text']:
                if chapter_id not in questions:
                    questions[chapter_id] = []
                # Make sure we don't have duplicates and it looks like a question
                if len(current_q['text']) > 15:
                    questions[chapter_id].append(current_q)
            
            current_q = {
                'id': match.group(1),
                'text': '',
                'options': [],
                'answer': 0, # Default to 0 for now since answers are at the end of the book
                'passage': None
            }
            continue
            
        if current_q:
            # if it starts with (A) or is a single word, might be an option
            if re.match(r'^\([A-E]\)', line) or (len(line.split()) <= 2 and line.islower()):
                current_q['options'].append(line)
            else:
                if len(current_q['options']) == 0:
                    current_q['text'] += line + ' '
                else:
                    # If we already have options, this might be a new passage or junk
                    pass
                    
    # save last
    if current_q and current_q['text'] and len(current_q['text']) > 15:
        if chapter_id not in questions:
            questions[chapter_id] = []
        questions[chapter_id].append(current_q)

    # Clean up options
    for cid, qlist in questions.items():
        for q in qlist:
            q['text'] = q['text'].strip()
            if not q['options']:
                q['options'] = ["(A) Option A", "(B) Option B", "(C) Option C", "(D) Option D", "(E) Option E"]

    with open('questions.json', 'w', encoding='utf-8') as f:
        json.dump(questions, f, indent=4)

if __name__ == '__main__':
    parse_questions('../extracted_text.txt')

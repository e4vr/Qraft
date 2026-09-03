"""Extract the phase-one question bank from the supplied PDF into app JSON.

The PDF has a usable text layer with a small set of consistent font-encoding
artifacts (for example, the glyph for "ti" is exposed as "7" or ">").  The
normalizer only repairs those artifacts and a short allow-list of obvious
spelling errors; it never changes an answer key.
"""

from __future__ import annotations

import bisect
import json
import re
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[2]
PDF_PATH = ROOT / "MedGard - GS first 51.pdf"
OUTPUT_PATH = ROOT / "app" / "data" / "questions.json"


WORD_FIXES = {
    "aOer": "after",
    "AOer": "After",
    "leO": "left",
    "LeO": "Left",
    "a.er": "after",
    "A.er": "After",
    "le.": "left",
    "Le.": "Left",
    "patent": "patient",
    "Patent": "Patient",
    "urethera": "urethra",
    "Cuboi": "Cuboid",
    "felt on an outstretched": "fell on an outstretched",
    "aOacks": "attacks",
    "aOack": "attack",
    "unevenRul": "uneventful",
    "admijed": "admitted",
    "soO": "soft",
    "ShiO": "Shift",
    "Curejage": "Curettage",
    "shaO": "shaft",
    "ajending": "attending",
    "intermiOent": "intermittent",
    "resuits": "results",
    "Upper Gl": "Upper GI",
    "blakmore": "Blakemore",
    "Hemithyroidectory": "Hemithyroidectomy",
    "heamothorax": "hemothorax",
    "floving": "following",
    "flowing": "following",
    "Urine out ": "Urine output ",
}


TOPICS: list[tuple[str, tuple[str, ...]]] = [
    ("Burns", ("burn", "chemical injury", "fluid resuscitation", "parkland")),
    ("Breast Surgery", ("breast", "nipple", "mammogram", "mastectomy")),
    ("Vascular Surgery", ("aneurysm", "varicose", "arterial", "vascular", "ischemic limb", "carotid", "aortic")),
    ("Orthopedics", ("fracture", "dislocation", "bone", "femur", "tibia", "fibula", "scaphoid", "osteomyelitis", "compartment")),
    ("Urology", ("ureth", "renal", "kidney", "bladder", "prostate", "testicular", "urinary", "haematuria", "hematuria")),
    ("Hepatobiliary & Pancreas", ("gall", "biliary", "liver", "hepatic", "pancrea", "cholang", "cholecyst")),
    ("Colorectal Surgery", ("colon", "rectal", "rectum", "appendic", "perianal", "hemorrhoid", "haemorrhoid")),
    ("Upper GI Surgery", ("esoph", "oesoph", "gastric", "stomach", "peptic", "duoden", "epigastric")),
    ("Pediatric Surgery", ("newborn", "neonate", "infant", "child", "pediatric", "paediatric", "pyloric", "intussusception")),
    ("Thoracic Surgery", ("chest", "lung", "pneumothorax", "hemothorax", "haemothorax", "thoracic", "trache")),
    ("Endocrine Surgery", ("thyroid", "parathyroid", "adrenal", "pheochromocytoma")),
    ("Hernia", ("hernia", "inguinal", "femoral canal")),
    ("Infections & Wounds", ("abscess", "wound", "infection", "gangrene", "debridement", "antibiotic", "secretion")),
    ("Trauma & Critical Care", ("motor vehicle", "stab", "trauma", "injury", "shock", "emergency department", "crash", "blunt")),
    ("Perioperative Care", ("postoperative", "preoperative", "operation", "surgical procedure", "anesthesia", "anaesthesia")),
]


def normalize_text(value: str) -> str:
    value = value.replace("\u00a0", " ").replace("\u0000", "")
    value = value.replace(">", "ti")
    value = re.sub(r"(?<=[A-Za-z])7(?=[A-Za-z])", "ti", value)
    value = re.sub(r"\b7(?=[A-Za-z])", "ti", value)
    for wrong, correct in WORD_FIXES.items():
        value = value.replace(wrong, correct)
    value = value.replace("�C", "°C").replace("� 109/L", "× 10^9/L")
    value = re.sub(r"\bx 109/L\b", "× 10^9/L", value, flags=re.IGNORECASE)
    value = re.sub(r"\bmmH\b", "mmHg", value)
    value = value.replace(" pU/mL", " µU/mL").replace(" q/L", " g/L")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\s*\n\s*", " ", value)
    return value.strip()


def classify(stem: str) -> str:
    lowered = stem.lower()
    for topic, keywords in TOPICS:
        if any(keyword in lowered for keyword in keywords):
            return topic
    return "General Surgery"


def clean_page(text: str, page_number: int) -> str:
    lines = text.splitlines()
    cleaned: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped == str(page_number):
            continue
        if page_number == 1 and stripped == "Surgery":
            continue
        cleaned.append(line)
    return "\n".join(cleaned).strip()


def extract() -> list[dict[str, object]]:
    page_boundaries: list[int] = []
    combined_parts: list[str] = []
    length = 0
    with pdfplumber.open(PDF_PATH) as document:
        for index, page in enumerate(document.pages, start=1):
            page_boundaries.append(length)
            page_text = clean_page(page.extract_text() or "", index)
            part = page_text + "\n"
            combined_parts.append(part)
            length += len(part)

    combined = "".join(combined_parts)
    answer_pattern = re.compile(r"Answer\s*:\s*([A-D])", re.IGNORECASE)
    option_pattern = re.compile(r"(?:^|\n)([A-D])\.\s*", re.MULTILINE)
    questions: list[dict[str, object]] = []
    previous_end = 0

    for match in answer_pattern.finditer(combined):
        block = combined[previous_end : match.start()].strip()
        previous_end = match.end()
        option_matches = list(option_pattern.finditer(block))
        if len(option_matches) != 4 or [m.group(1).upper() for m in option_matches] != list("ABCD"):
            raise ValueError(
                f"Question {len(questions) + 1}: expected A-D options, found "
                f"{[m.group(1) for m in option_matches]}\n{block[:500]}"
            )

        stem = normalize_text(block[: option_matches[0].start()])
        options: list[str] = []
        for option_index, option_match in enumerate(option_matches):
            start = option_match.end()
            end = option_matches[option_index + 1].start() if option_index < 3 else len(block)
            options.append(normalize_text(block[start:end]))

        if not stem or any(not option for option in options):
            raise ValueError(f"Question {len(questions) + 1}: empty stem or option")

        source_position = previous_end - len(match.group(0)) - len(block)
        source_page = bisect.bisect_right(page_boundaries, max(0, source_position))
        answer_letter = match.group(1).upper()
        questions.append(
            {
                "id": f"gs-{len(questions) + 1:03d}",
                "questionId": f"{len(questions) + 1:05d}",
                "number": len(questions) + 1,
                "specialty": "Surgery",
                "topic": classify(stem),
                "stem": stem,
                "options": options,
                "answer": "ABCD".index(answer_letter),
                "answerLetter": answer_letter,
                "sourcePage": source_page,
                "sourceFile": PDF_PATH.name,
                "revision": 1,
                "images": [],
            }
        )

    if len(questions) != 217:
        raise ValueError(f"Expected 217 questions, extracted {len(questions)}")
    return questions


def main() -> None:
    questions = extract()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(questions, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(questions)} questions to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

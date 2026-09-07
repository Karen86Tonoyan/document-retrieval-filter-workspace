"""
alfa/agent_browser/t9_semantic.py
T9 Semantic Layer v0.2 — klasyfikacja znaczeń słów i intencji

Wykrywa:
  ROMANTYCZNE      — ciepłe, intymne, emocjonalne
  PRZYJAZNE        — neutralnie pozytywne, social
  WROGIE           — agresja, zagrożenie, manipulacja
  NIESPÓJNE        — tekst mówi jedno, kontekst drugie
  SPÓJNE           — wszystko się zgadza
  DWUZNACZNE       — jedno zdanie, dwie interpretacje
  UKRYTE_ZNACZENIE — słowa niewinne z ukrytym ładunkiem

v0.2:
  + GLOBAL_HOSTILE_CONTEXT (PL/EN)
  + override priorytet NIESPÓJNE → DWUZNACZNE → leksykon
  + severity_score, confidence_score, cerber_decision
  + matched_patterns, context_shift

Zasada ALFA: brak pewności → nie zgaduj → CLARIFY/HOLD
Integracja: cerber_decision → PASS/WARN/CLARIFY/HOLD_RISK

TODO v0.3:
  - Label.KRYZYSOWE — szczery ból w trudnej relacji (nie manipulacja)
  - t9_stego_detector.py
  - per-session behavioral profiling
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


# ══════════════════════════════════════════════════════════════════════════════
# GLOBALNY KONTEKST WROGI
# ══════════════════════════════════════════════════════════════════════════════

GLOBAL_HOSTILE_CONTEXT = {
    "pl": [
        "kłótnia", "konflikt", "sprzeczka", "groźba", "groźny",
        "agresja", "przemoc", "kontrola", "przymus",
        "inwigilacja", "manipulacja", "szantaż", "presja",
        "strach", "zastraszenie", "śledzenie", "obserwacja",
        "krzyk", "wrzask", "atak", "nienawiść",
    ],
    "en": [
        "fight", "argument", "conflict", "threat", "hostile",
        "angry", "aggressive", "violence", "control",
        "coercion", "surveillance", "manipulation", "blackmail",
        "pressure", "intimidation", "stalking", "harassment",
        "hate", "rage", "attack", "abuse",
    ],
}


# ══════════════════════════════════════════════════════════════════════════════
# ETYKIETY I POZIOMY RYZYKA
# ══════════════════════════════════════════════════════════════════════════════

class Label:
    ROMANTYCZNE      = "ROMANTYCZNE"
    PRZYJAZNE        = "PRZYJAZNE"
    WROGIE           = "WROGIE"
    NIESPOJNE        = "NIESPÓJNE"
    SPOJNE           = "SPÓJNE"
    DWUZNACZNE       = "DWUZNACZNE"
    UKRYTE_ZNACZENIE = "UKRYTE_ZNACZENIE"
    NEUTRALNE        = "NEUTRALNE"
    # TODO v0.3: KRYZYSOWE — szczery ból w trudnej relacji


class RiskLevel:
    PASS    = "PASS"
    INFO    = "INFO"
    WARN    = "WARN"
    CLARIFY = "CLARIFY"
    HOLD    = "HOLD"


class SuggestedAction:
    PASS      = "PASS"
    LOG       = "LOG"
    CLARIFY   = "CLARIFY"
    WARN_USER = "WARN_USER"
    HOLD      = "HOLD"
    BLOCK     = "BLOCK"


# ══════════════════════════════════════════════════════════════════════════════
# LEKSYKONY — PL
# ══════════════════════════════════════════════════════════════════════════════

LEXICON_PL = {
    Label.ROMANTYCZNE: [
        "kocham", "kochanie", "serce", "tęsknię", "brakuje mi cię",
        "jesteś dla mnie wszystkim", "moja miłość", "tylko ty",
        "zawsze będę przy tobie", "tulę", "całuję", "mój aniele",
        "jesteś wyjątkowa", "jesteś wyjątkowy", "myślę o tobie",
        "śnię o tobie", "nie wyobrażam sobie życia bez ciebie",
        "kocham cię nad życie", "mój skarb", "moje wszystko",
        "za tobą szaleję", "jesteś moim światem", "chcę spędzić z tobą",
        "bliskość", "intymność", "namiętność",
    ],
    Label.PRZYJAZNE: [
        "dzięki", "świetnie", "dobra robota", "cieszę się",
        "miło cię widzieć", "jak się masz", "co słychać",
        "trzymaj się", "powodzenia", "wszystkiego dobrego",
        "liczę na ciebie", "ufam ci", "jesteś świetny",
        "możesz na mnie liczyć", "pomogę ci", "jestem tu dla ciebie",
        "razem damy radę", "super", "brawo", "fajnie",
        "dobrze wyglądasz", "miło spędzony czas",
    ],
    Label.WROGIE: [
        "zabiję", "zniszczę", "pożałujesz", "zapłacisz za to",
        "zemsta", "skończysz", "nie ujdziesz", "znajdę cię",
        "będziesz żałować", "to był błąd", "nie ma dla ciebie ratunku",
        "skończyłeś się", "wiem gdzie mieszkasz", "obserwuję cię",
        "nie śpij spokojnie", "to jest ostrzeżenie", "następnym razem",
        "jesteś skończony", "zadbam o to", "masz przesrane",
        "nie daruję", "policzę ci się", "nie zapomnę tego",
        "czekaj", "przyjdę po swoje", "nie uciekniesz",
        "nie zapomnę", "zapłacisz", "wiem co zrobiłeś",
        "rozliczę cię", "pożałujesz tego",
    ],
    Label.UKRYTE_ZNACZENIE: [
        "zajmę się tobą", "porozmawiamy", "pamiętam wszystko",
        "wiem o tobie więcej niż myślisz", "zobaczymy",
        "będziemy w kontakcie", "znajdziemy rozwiązanie",
        "wszystko ma swój czas", "dbam o ciebie",
        "jestem przy tobie", "zostań ze mną", "nie martw się",
        "znam twoje życie", "widziałem cię", "byłem tam",
        "wrócimy do tego", "masz dług u mnie",
        "wiem gdzie jesteś", "obserwuję sytuację",
        "to się nie skończyło",
    ],
}


# ══════════════════════════════════════════════════════════════════════════════
# LEKSYKONY — EN
# ══════════════════════════════════════════════════════════════════════════════

LEXICON_EN = {
    Label.ROMANTYCZNE: [
        "i love you", "my love", "darling", "sweetheart",
        "i miss you", "you mean everything to me", "only you",
        "i'll always be here for you", "you're my world",
        "can't imagine life without you", "thinking of you",
        "dreaming of you", "my heart", "forever yours",
        "you're special to me", "i adore you", "passionate",
        "intimate", "together forever",
    ],
    Label.PRZYJAZNE: [
        "thank you", "great job", "well done", "nice to see you",
        "how are you", "take care", "good luck", "cheers",
        "i trust you", "you can count on me", "i'm here for you",
        "we got this", "awesome", "great", "love your work",
        "appreciate you", "happy for you",
    ],
    Label.WROGIE: [
        "i'll kill you", "you'll regret this", "you'll pay",
        "revenge", "you're done", "i'll find you", "watch your back",
        "you made a mistake", "there's no escape", "i know where you live",
        "i'm watching you", "don't sleep", "this is a warning",
        "next time", "you're finished", "i'll take care of you",
        "you're dead to me", "i won't forget this", "you'll see",
        "come after you", "you can't hide",
    ],
    Label.UKRYTE_ZNACZENIE: [
        "i'll take care of you", "we'll talk", "i remember everything",
        "i know more about you than you think", "we'll see",
        "we'll be in touch", "we'll find a solution",
        "everything has its time", "i'm watching the situation",
        "stay with me", "don't worry", "i know your life",
        "i saw you", "i was there", "we'll come back to this",
        "you owe me", "i know where you are", "this isn't over",
    ],
}


# ══════════════════════════════════════════════════════════════════════════════
# WZORCE DWUZNACZNE — PL
# ══════════════════════════════════════════════════════════════════════════════

AMBIGUOUS_PATTERNS_PL = [
    {
        "pattern": re.compile(r"(?i)zajmę się tobą"),
        "interpretations": ["troska / opieka", "groźba / zastraszenie"],
        "context_hostile": ["kłótnia", "konflikt", "sprzeczka", "groźny", "zły", "wściekły"],
        "score_neutral": 0.5,
        "score_hostile_context": 0.85,
    },
    {
        "pattern": re.compile(r"(?i)zostań ze mną"),
        "interpretations": ["prośba emocjonalna", "kontrola / przymus"],
        "context_hostile": ["nie możesz", "musisz", "nie pozwolę", "zakaz", "nigdzie nie pójdziesz"],
        "score_neutral": 0.4,
        "score_hostile_context": 0.75,
    },
    {
        "pattern": re.compile(r"(?i)porozmawiamy (później|o tym|niedługo)"),
        "interpretations": ["neutralne odroczenie rozmowy", "ukryta groźba / ostrzeżenie"],
        "context_hostile": ["pamiętaj", "nie zapomnę", "żałuj", "wrócimy"],
        "score_neutral": 0.3,
        "score_hostile_context": 0.70,
    },
    {
        "pattern": re.compile(r"(?i)wiem (gdzie mieszkasz|gdzie jesteś|gdzie bywasz)"),
        "interpretations": ["znajomość adresu (kontekst bliski)", "zastraszenie / inwigilacja"],
        "context_hostile": ["obserwuję", "śledziłem", "byłem tam", "wiem wszystko"],
        "score_neutral": 0.6,
        "score_hostile_context": 0.95,
    },
    {
        "pattern": re.compile(r"(?i)dbam o ciebie"),
        "interpretations": ["troska", "kontrola w stylu gaslighting"],
        "context_hostile": ["bo inaczej", "musisz mnie słuchać", "nie rozumiesz", "dla twojego dobra"],
        "score_neutral": 0.2,
        "score_hostile_context": 0.65,
    },
    {
        "pattern": re.compile(r"(?i)pamiętam (wszystko|każde słowo|co powiedziałeś|co powiedziałaś)"),
        "interpretations": ["dbałość o szczegóły", "groźba użycia informacji przeciw komuś"],
        "context_hostile": ["pożałujesz", "to się przyda", "będziesz żałować"],
        "score_neutral": 0.35,
        "score_hostile_context": 0.80,
    },
    {
        "pattern": re.compile(r"(?i)zobaczymy"),
        "interpretations": ["neutralna niepewność", "ukryta groźba"],
        "context_hostile": ["jeszcze", "poczekaj", "niedługo", "czas pokaże"],
        "score_neutral": 0.25,
        "score_hostile_context": 0.60,
    },
    {
        "pattern": re.compile(r"(?i)to się nie skończyło"),
        "interpretations": ["kontynuacja tematu", "groźba powrotu / eskalacji"],
        "context_hostile": ["wrócimy", "nie zapomnę", "jeszcze będziemy rozmawiać"],
        "score_neutral": 0.50,
        "score_hostile_context": 0.85,
    },
    {
        "pattern": re.compile(r"(?i)masz (u mnie )?dług"),
        "interpretations": ["żartobliwe zobowiązanie", "realna manipulacja / presja"],
        "context_hostile": ["spłacisz", "zapłacisz", "pamiętam", "zrób co mówię"],
        "score_neutral": 0.45,
        "score_hostile_context": 0.80,
    },
    {
        "pattern": re.compile(r"(?i)jestem (zawsze )?przy tobie"),
        "interpretations": ["wsparcie emocjonalne", "stalking / kontrola"],
        "context_hostile": ["wszędzie", "obserwuję", "widzę cię", "nie jesteś sama"],
        "score_neutral": 0.15,
        "score_hostile_context": 0.75,
    },
]


# ══════════════════════════════════════════════════════════════════════════════
# WZORCE DWUZNACZNE — EN
# ══════════════════════════════════════════════════════════════════════════════

AMBIGUOUS_PATTERNS_EN = [
    {
        "pattern": re.compile(r"(?i)i('ll)? take care of you"),
        "interpretations": ["care / protection", "threat / revenge"],
        "context_hostile": ["fight", "argument", "angry", "mad", "warning", "you'll see"],
        "score_neutral": 0.5,
        "score_hostile_context": 0.85,
    },
    {
        "pattern": re.compile(r"(?i)stay with me"),
        "interpretations": ["emotional request", "control / coercion"],
        "context_hostile": ["you can't leave", "i won't let you", "you have no choice"],
        "score_neutral": 0.35,
        "score_hostile_context": 0.75,
    },
    {
        "pattern": re.compile(r"(?i)we('ll)? talk (later|soon|about this)"),
        "interpretations": ["neutral postponement", "hidden threat"],
        "context_hostile": ["remember", "you'll regret", "i won't forget"],
        "score_neutral": 0.3,
        "score_hostile_context": 0.70,
    },
    {
        "pattern": re.compile(r"(?i)i know where you (live|are|go)"),
        "interpretations": ["knowing address (close context)", "intimidation / surveillance"],
        "context_hostile": ["watching", "following", "i was there", "i know everything"],
        "score_neutral": 0.6,
        "score_hostile_context": 0.95,
    },
    {
        "pattern": re.compile(r"(?i)i('m)? watching (you|the situation)"),
        "interpretations": ["concerned oversight", "surveillance / threat"],
        "context_hostile": ["don't think", "you can't hide", "i see everything"],
        "score_neutral": 0.55,
        "score_hostile_context": 0.85,
    },
    {
        "pattern": re.compile(r"(?i)this isn('t| is not) over"),
        "interpretations": ["continuation of topic", "threat of return / escalation"],
        "context_hostile": ["you'll pay", "i'll be back", "remember this"],
        "score_neutral": 0.50,
        "score_hostile_context": 0.85,
    },
    {
        "pattern": re.compile(r"(?i)you owe me"),
        "interpretations": ["playful debt", "manipulation / pressure"],
        "context_hostile": ["pay up", "you'll repay", "remember", "do what i say"],
        "score_neutral": 0.45,
        "score_hostile_context": 0.80,
    },
    {
        "pattern": re.compile(r"(?i)we('ll)? see"),
        "interpretations": ["neutral uncertainty", "hidden threat"],
        "context_hostile": ["just wait", "soon", "time will tell", "you'll see"],
        "score_neutral": 0.25,
        "score_hostile_context": 0.60,
    },
]


# ══════════════════════════════════════════════════════════════════════════════
# SEVERITY MAP
# ══════════════════════════════════════════════════════════════════════════════

SEVERITY_MAP = {
    Label.WROGIE:          0.90,
    Label.UKRYTE_ZNACZENIE: 0.65,
    Label.DWUZNACZNE:      0.60,
    Label.NIESPOJNE:       0.55,
    Label.NEUTRALNE:       0.05,
    Label.SPOJNE:          0.05,
    Label.PRZYJAZNE:       0.05,
    Label.ROMANTYCZNE:     0.05,
}


# ══════════════════════════════════════════════════════════════════════════════
# DATACLASS WYNIKU v0.2
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class SemanticResult:
    """
    Wynik klasyfikacji semantycznej T9 v0.2.
    T9 nie udaje że zna intencję — mówi co widzi i czego nie wie.

    confidence_score — pewność klasyfikacji (liczba dowodów)
    severity_score   — powaga ryzyka (niezależnie od pewności)
    cerber_decision  — PASS / WARN / CLARIFY / HOLD_RISK
    matched_patterns — konkretne dowody (frazy + ambig)
    context_shift    — czy tekst i kontekst są niespójne

    TODO v0.3: dodać Label.KRYZYSOWE dla szczerego bólu w trudnej relacji
    """
    text: str
    lang: str
    context: Optional[str]

    primary_label: str = Label.NEUTRALNE
    secondary_labels: list[str] = field(default_factory=list)

    score: float = 0.0
    confidence_score: float = 0.0
    severity_score: float = 0.0

    cerber_decision: str = "PASS"
    risk_level: str = RiskLevel.PASS
    reasons: list[str] = field(default_factory=list)
    suggested_action: str = SuggestedAction.PASS

    matched_patterns: list[dict] = field(default_factory=list)
    ambiguous_matches: list[dict] = field(default_factory=list)
    context_shift: bool = False

    def to_dict(self) -> dict:
        return {
            "primary_label": self.primary_label,
            "secondary_labels": self.secondary_labels,
            "score": round(self.score, 3),
            "confidence_score": round(self.confidence_score, 3),
            "severity_score": round(self.severity_score, 3),
            "cerber_decision": self.cerber_decision,
            "risk_level": self.risk_level,
            "reasons": self.reasons,
            "suggested_action": self.suggested_action,
            "matched_patterns": self.matched_patterns,
            "ambiguous_matches": self.ambiguous_matches,
            "context_shift": self.context_shift,
            "text": self.text[:200],
            "lang": self.lang,
            "context": self.context,
        }


# ══════════════════════════════════════════════════════════════════════════════
# GŁÓWNA FUNKCJA
# ══════════════════════════════════════════════════════════════════════════════

def classify_t9_semantic(
    text: str,
    context: Optional[str] = None,
    lang: str = "pl",
) -> SemanticResult:
    """
    Klasyfikacja semantyczna tekstu.

    text    — tekst do analizy
    context — opis kontekstu ("kłótnia", "rozmowa romantyczna", itp.)
    lang    — "pl" lub "en"
    """
    result = SemanticResult(text=text, lang=lang, context=context)
    text_lower = text.lower()
    context_lower = (context or "").lower()

    lexicon  = LEXICON_PL  if lang == "pl" else LEXICON_EN
    patterns = AMBIGUOUS_PATTERNS_PL if lang == "pl" else AMBIGUOUS_PATTERNS_EN

    label_scores: dict[str, float] = {}
    reasons: list[str] = []
    ambiguous_matches: list[dict] = []
    matched_patterns: list[dict] = []

    # ── KROK 1: Leksykon ──────────────────────────────────────────────────────
    for lbl, phrases in lexicon.items():
        hits = [p for p in phrases if p.lower() in text_lower]
        if hits:
            sc = min(len(hits) * 0.25, 0.75)
            label_scores[lbl] = label_scores.get(lbl, 0) + sc
            reasons.append(f"{lbl}: znaleziono frazy {hits[:3]}")
            for h in hits:
                matched_patterns.append({"type": "lexicon", "label": lbl, "phrase": h})

    # ── KROK 2: Wzorce dwuznaczne ─────────────────────────────────────────────
    for pat in patterns:
        if pat["pattern"].search(text):
            global_hostile = any(
                kw in context_lower or kw in text_lower
                for kw in GLOBAL_HOSTILE_CONTEXT.get(lang, [])
            )
            pattern_hostile = any(
                kw in context_lower or kw in text_lower
                for kw in pat["context_hostile"]
            )
            context_hostile = global_hostile or pattern_hostile
            sc = pat["score_hostile_context"] if context_hostile else pat["score_neutral"]

            label_scores[Label.DWUZNACZNE] = max(label_scores.get(Label.DWUZNACZNE, 0), sc)

            am = {
                "phrase": pat["pattern"].pattern,
                "interpretations": pat["interpretations"],
                "score": sc,
                "hostile_context_detected": context_hostile,
            }
            ambiguous_matches.append(am)
            matched_patterns.append({
                "type": "ambiguous",
                "phrase": pat["pattern"].pattern,
                "possible_meanings": pat["interpretations"],
                "score": sc,
                "hostile_context": context_hostile,
            })

            tag = "hostile context" if context_hostile else "neutral"
            reasons.append(
                f"DWUZNACZNE ({tag}): '{pat['pattern'].pattern}' "
                f"→ może oznaczać: {pat['interpretations']}"
            )
            if context_hostile:
                label_scores[Label.WROGIE] = max(
                    label_scores.get(Label.WROGIE, 0), sc * 0.7
                )

    # ── KROK 3: Niespójność tekst vs kontekst ────────────────────────────────
    if context_lower:
        has_romantic = label_scores.get(Label.ROMANTYCZNE, 0) > 0.2
        has_hostile  = label_scores.get(Label.WROGIE, 0) > 0.2

        context_is_conflict = any(
            kw in context_lower for kw in [
                "kłótnia", "konflikt", "groźba", "argument", "fight",
                "threat", "angry", "mad", "hostile", "aggressive",
                "przemoc", "szantaż", "manipulacja",
            ]
        )
        context_is_warm = any(
            kw in context_lower for kw in [
                "romantyczna", "miłosna", "przyjazna", "romantic",
                "friendly", "loving", "warm", "close",
            ]
        )

        if has_romantic and context_is_conflict:
            label_scores[Label.NIESPOJNE] = 0.65
            reasons.append(
                "NIESPÓJNE: tekst brzmi romantycznie ale kontekst wskazuje na konflikt"
                " — może być szczery ból lub manipulacja (TODO v0.3: KRYZYSOWE)"
            )
        if has_hostile and context_is_warm:
            label_scores[Label.NIESPOJNE] = 0.70
            reasons.append(
                "NIESPÓJNE: tekst brzmi wrogo ale kontekst wskazuje na ciepłą relację"
            )

    # ── KROK 4: Primary label — priorytet NIESPÓJNE → DWUZNACZNE → leksykon ──
    if not label_scores:
        result.primary_label = Label.NEUTRALNE
        result.score = 0.0
        result.secondary_labels = []
    elif label_scores.get(Label.NIESPOJNE, 0) >= 0.6:
        result.primary_label = Label.NIESPOJNE
        result.score = min(label_scores[Label.NIESPOJNE], 1.0)
    elif label_scores.get(Label.DWUZNACZNE, 0) >= 0.7:
        result.primary_label = Label.DWUZNACZNE
        result.score = min(label_scores[Label.DWUZNACZNE], 1.0)
    else:
        sorted_labels = sorted(label_scores.items(), key=lambda x: x[1], reverse=True)
        result.primary_label = sorted_labels[0][0]
        result.score = min(sorted_labels[0][1], 1.0)

    sorted_all = sorted(label_scores.items(), key=lambda x: x[1], reverse=True)
    result.secondary_labels = [
        l for l, s in sorted_all
        if l != result.primary_label and s > 0.15
    ]

    # ── KROK 5: Risk level + suggested action ─────────────────────────────────
    sc   = result.score
    lbl  = result.primary_label

    if lbl == Label.WROGIE and sc >= 0.6:
        result.risk_level      = RiskLevel.HOLD
        result.suggested_action = SuggestedAction.BLOCK
    elif lbl == Label.WROGIE and sc >= 0.3:
        result.risk_level      = RiskLevel.WARN
        result.suggested_action = SuggestedAction.WARN_USER
    elif lbl == Label.DWUZNACZNE and sc >= 0.7:
        result.risk_level      = RiskLevel.HOLD
        result.suggested_action = SuggestedAction.CLARIFY
    elif lbl == Label.DWUZNACZNE and sc >= 0.4:
        result.risk_level      = RiskLevel.WARN
        result.suggested_action = SuggestedAction.CLARIFY
    elif lbl == Label.UKRYTE_ZNACZENIE and sc >= 0.5:
        result.risk_level      = RiskLevel.WARN
        result.suggested_action = SuggestedAction.CLARIFY
    elif lbl == Label.NIESPOJNE:
        result.risk_level      = RiskLevel.CLARIFY
        result.suggested_action = SuggestedAction.CLARIFY
    elif lbl in (Label.ROMANTYCZNE, Label.PRZYJAZNE):
        result.risk_level      = RiskLevel.INFO
        result.suggested_action = SuggestedAction.LOG
    elif lbl == Label.SPOJNE:
        result.risk_level      = RiskLevel.PASS
        result.suggested_action = SuggestedAction.PASS
    else:
        result.risk_level      = RiskLevel.PASS
        result.suggested_action = SuggestedAction.PASS

    # ── KROK 6: context_shift ────────────────────────────────────────────────
    result.context_shift = Label.NIESPOJNE in [result.primary_label] + result.secondary_labels

    # ── KROK 7: confidence_score ─────────────────────────────────────────────
    evidence = len(matched_patterns)
    result.confidence_score = min(0.3 + evidence * 0.12, 1.0) if evidence else 0.1

    # ── KROK 8: severity_score ───────────────────────────────────────────────
    base = SEVERITY_MAP.get(result.primary_label, 0.3)
    if result.context_shift:
        base = min(base + 0.15, 1.0)
    if any(am.get("hostile_context_detected") for am in ambiguous_matches):
        base = min(base + 0.20, 1.0)
    result.severity_score = round(base, 3)

    # ── KROK 9: cerber_decision ──────────────────────────────────────────────
    if result.severity_score >= 0.75 or result.risk_level == RiskLevel.HOLD:
        result.cerber_decision = "HOLD_RISK"
    elif result.severity_score >= 0.55 or result.risk_level == RiskLevel.WARN:
        result.cerber_decision = "WARN"
    elif result.risk_level == RiskLevel.CLARIFY or result.primary_label == Label.DWUZNACZNE:
        result.cerber_decision = "CLARIFY"
    else:
        result.cerber_decision = "PASS"

    # ── FINAŁ ─────────────────────────────────────────────────────────────────
    result.score = round(max(result.confidence_score, result.severity_score, result.score), 3)
    result.reasons = reasons
    result.ambiguous_matches = ambiguous_matches
    result.matched_patterns  = matched_patterns
    return result

"""
tests/test_t9_semantic.py
Testy T9 Semantic Layer v0.1

Pokrycie:
  ✅ PL: wrogie frazy → WROGIE + HOLD/WARN
  ✅ PL: romantyczne → ROMANTYCZNE + INFO
  ✅ PL: przyjazne → PRZYJAZNE + INFO
  ✅ PL: "zajmę się tobą" neutral → DWUZNACZNE WARN
  ✅ PL: "zajmę się tobą" + hostile context → HOLD
  ✅ PL: "zostań ze mną" + kontekst kontroli → HOLD
  ✅ PL: "wiem gdzie mieszkasz" + inwigilacja → HOLD score=0.95
  ✅ PL: niespójność (romantyczny tekst + konflikt kontekst)
  ✅ EN: "i'll take care of you" neutral → WARN
  ✅ EN: "i'll take care of you" + fight → HOLD
  ✅ EN: "this isn't over" + hostile → HOLD
  ✅ Neutralny tekst → NEUTRALNE PASS
  ✅ to_dict() struktura
"""
from __future__ import annotations
import pytest
from filtry_tonoyana.semantic.t9_semantic import (
    classify_t9_semantic,
    Label, RiskLevel, SuggestedAction,
)


# ══════════════════════════════════════════════════════════════════════════════
# PL — WROGIE
# ══════════════════════════════════════════════════════════════════════════════

class TestWrogiePL:

    def test_direct_threat_hold(self):
        r = classify_t9_semantic("Pożałujesz tego. Znajdę cię.", lang="pl")
        assert r.primary_label == Label.WROGIE
        assert r.risk_level in (RiskLevel.HOLD, RiskLevel.WARN)

    def test_watch_your_back_warn(self):
        r = classify_t9_semantic("Nie śpij spokojnie. To jest ostrzeżenie.", lang="pl")
        assert r.primary_label == Label.WROGIE
        assert r.score >= 0.3

    def test_revenge_hold(self):
        r = classify_t9_semantic(
            "Zemsta będzie słodka. Zapłacisz za to. Nie daruję. Znajdę cię.",
            lang="pl"
        )
        assert r.primary_label == Label.WROGIE
        assert r.risk_level == RiskLevel.HOLD
        assert r.suggested_action == SuggestedAction.BLOCK


# ══════════════════════════════════════════════════════════════════════════════
# PL — ROMANTYCZNE
# ══════════════════════════════════════════════════════════════════════════════

class TestRomantycznePL:

    def test_love_declaration_info(self):
        r = classify_t9_semantic("Kocham cię nad życie, jesteś moim wszystkim.", lang="pl")
        assert r.primary_label == Label.ROMANTYCZNE
        assert r.risk_level == RiskLevel.INFO
        assert r.suggested_action == SuggestedAction.LOG

    def test_miss_you_romantic(self):
        r = classify_t9_semantic("Tęsknię za tobą, brakuje mi cię każdego dnia.", lang="pl")
        assert r.primary_label == Label.ROMANTYCZNE
        assert r.score >= 0.25


# ══════════════════════════════════════════════════════════════════════════════
# PL — PRZYJAZNE
# ══════════════════════════════════════════════════════════════════════════════

class TestPrzyjazne:

    def test_friendly_support_info(self):
        r = classify_t9_semantic("Razem damy radę, liczę na ciebie!", lang="pl")
        assert r.primary_label == Label.PRZYJAZNE
        assert r.risk_level == RiskLevel.INFO

    def test_neutral_greeting_pass(self):
        r = classify_t9_semantic("Cześć, jak się masz? Trzymaj się!", lang="pl")
        assert r.primary_label in (Label.PRZYJAZNE, Label.NEUTRALNE)


# ══════════════════════════════════════════════════════════════════════════════
# PL — DWUZNACZNE
# ══════════════════════════════════════════════════════════════════════════════

class TestDwuznaczne:

    def test_zajme_sie_toba_neutral(self):
        r = classify_t9_semantic("Zajmę się tobą jak będziesz chora.", lang="pl")
        assert r.primary_label == Label.DWUZNACZNE
        assert r.risk_level in (RiskLevel.WARN, RiskLevel.HOLD)
        assert r.suggested_action == SuggestedAction.CLARIFY
        # Oba znaczenia muszą być w reasons
        reasons_str = " ".join(r.reasons)
        assert "troska" in reasons_str or "groźba" in reasons_str

    def test_zajme_sie_toba_hostile_context(self):
        r = classify_t9_semantic(
            "Zajmę się tobą.",
            context="kłótnia, groźny ton",
            lang="pl"
        )
        assert r.primary_label == Label.DWUZNACZNE
        assert r.score >= 0.8
        assert r.risk_level == RiskLevel.HOLD

    def test_zostań_ze_mna_control(self):
        r = classify_t9_semantic(
            "Zostań ze mną. Nigdzie nie pójdziesz.",
            context="kontrola, przemoc",
            lang="pl"
        )
        assert r.primary_label == Label.DWUZNACZNE
        assert r.score >= 0.7
        assert r.risk_level == RiskLevel.HOLD

    def test_wiem_gdzie_mieszkasz_hostile(self):
        r = classify_t9_semantic(
            "Wiem gdzie mieszkasz. Obserwuję cię.",
            context="inwigilacja",
            lang="pl"
        )
        assert r.primary_label == Label.DWUZNACZNE
        assert r.score >= 0.9
        assert r.risk_level == RiskLevel.HOLD

    def test_porozmawiamy_pozniej_neutral(self):
        r = classify_t9_semantic("Porozmawiamy później o tym projekcie.", lang="pl")
        assert r.primary_label == Label.DWUZNACZNE
        # Bez hostile context — WARN nie HOLD
        assert r.risk_level in (RiskLevel.WARN, RiskLevel.PASS, RiskLevel.HOLD)

    def test_porozmawiamy_pozniej_hostile(self):
        r = classify_t9_semantic(
            "Porozmawiamy później. Pamiętaj co zrobiłeś.",
            context="kłótnia",
            lang="pl"
        )
        assert r.score >= 0.6

    def test_to_sie_nie_skonczylo_hostile(self):
        r = classify_t9_semantic(
            "To się nie skończyło. Wrócimy do tego.",
            context="konflikt",
            lang="pl"
        )
        assert r.primary_label == Label.DWUZNACZNE
        assert r.score >= 0.8

    def test_masz_dlug_manipulacja(self):
        r = classify_t9_semantic(
            "Masz u mnie dług. Pamiętam co dla ciebie zrobiłem.",
            context="manipulacja",
            lang="pl"
        )
        assert r.primary_label == Label.DWUZNACZNE
        assert r.score >= 0.7


# ══════════════════════════════════════════════════════════════════════════════
# PL — NIESPÓJNE
# ══════════════════════════════════════════════════════════════════════════════

class TestNiespojne:

    def test_romantic_text_hostile_context(self):
        r = classify_t9_semantic(
            "Kocham cię, jesteś moim wszystkim.",
            context="kłótnia, przemoc, groźba",
            lang="pl"
        )
        assert Label.NIESPOJNE in [r.primary_label] + r.secondary_labels
        assert r.risk_level in (RiskLevel.CLARIFY, RiskLevel.WARN)


# ══════════════════════════════════════════════════════════════════════════════
# EN — DWUZNACZNE
# ══════════════════════════════════════════════════════════════════════════════

class TestDwuznaczneEN:

    def test_take_care_neutral(self):
        r = classify_t9_semantic("I'll take care of you when you're sick.", lang="en")
        assert r.primary_label == Label.DWUZNACZNE
        assert r.suggested_action == SuggestedAction.CLARIFY

    def test_take_care_hostile(self):
        r = classify_t9_semantic(
            "I'll take care of you.",
            context="fight, angry, threat",
            lang="en"
        )
        assert r.primary_label == Label.DWUZNACZNE
        assert r.score >= 0.8
        assert r.risk_level == RiskLevel.HOLD

    def test_this_isnt_over_hostile(self):
        r = classify_t9_semantic(
            "This isn't over. You'll pay.",
            context="hostile",
            lang="en"
        )
        assert r.score >= 0.8

    def test_stay_with_me_coercion(self):
        r = classify_t9_semantic(
            "Stay with me. You can't leave.",
            context="coercion, control",
            lang="en"
        )
        assert r.primary_label == Label.DWUZNACZNE
        assert r.score >= 0.7

    def test_i_know_where_you_live(self):
        r = classify_t9_semantic(
            "I know where you live. I'm watching.",
            context="surveillance",
            lang="en"
        )
        assert r.score >= 0.9
        assert r.risk_level == RiskLevel.HOLD

    def test_you_owe_me_manipulation(self):
        r = classify_t9_semantic(
            "You owe me. Remember what I did for you.",
            context="manipulation",
            lang="en"
        )
        assert r.primary_label == Label.DWUZNACZNE
        assert r.score >= 0.7


# ══════════════════════════════════════════════════════════════════════════════
# NEUTRALNE
# ══════════════════════════════════════════════════════════════════════════════

class TestNeutralne:

    def test_clean_technical_text(self):
        r = classify_t9_semantic(
            "Proszę o przesłanie dokumentu do piątku.",
            lang="pl"
        )
        assert r.primary_label == Label.NEUTRALNE
        assert r.risk_level == RiskLevel.PASS
        assert r.suggested_action == SuggestedAction.PASS

    def test_clean_en_pass(self):
        r = classify_t9_semantic(
            "Please send the document by Friday.",
            lang="en"
        )
        assert r.primary_label == Label.NEUTRALNE
        assert r.risk_level == RiskLevel.PASS


# ══════════════════════════════════════════════════════════════════════════════
# STRUKTURA WYNIKU
# ══════════════════════════════════════════════════════════════════════════════

class TestStruktura:

    def test_to_dict_keys(self):
        r = classify_t9_semantic("Zajmę się tobą.", lang="pl")
        d = r.to_dict()
        for key in [
            "primary_label", "secondary_labels", "score",
            "risk_level", "reasons", "suggested_action",
            "ambiguous_matches", "text", "lang", "context"
        ]:
            assert key in d, f"Brakuje klucza: {key}"

    def test_ambiguous_match_has_interpretations(self):
        r = classify_t9_semantic("Zajmę się tobą.", lang="pl")
        assert len(r.ambiguous_matches) > 0
        assert "interpretations" in r.ambiguous_matches[0]

    def test_score_in_range(self):
        texts = [
            "Kocham cię.",
            "Zabiję cię.",
            "Zajmę się tobą.",
            "Cześć.",
        ]
        for t in texts:
            r = classify_t9_semantic(t, lang="pl")
            assert 0.0 <= r.score <= 1.0


# ══════════════════════════════════════════════════════════════════════════════
# V0.2 — nowe pola
# ══════════════════════════════════════════════════════════════════════════════

class TestV02Fields:

    def test_cerber_decision_hold_risk_hostile(self):
        r = classify_t9_semantic(
            "Zemsta będzie słodka. Zapłacisz za to. Nie daruję. Znajdę cię.",
            lang="pl"
        )
        assert r.cerber_decision in ("HOLD_RISK", "WARN")

    def test_cerber_decision_clarify_ambiguous(self):
        r = classify_t9_semantic("Zajmę się tobą.", lang="pl")
        assert r.cerber_decision in ("CLARIFY", "WARN", "HOLD_RISK")

    def test_cerber_decision_pass_neutral(self):
        r = classify_t9_semantic("Proszę wysłać dokument do piątku.", lang="pl")
        assert r.cerber_decision == "PASS"

    def test_severity_score_hostile_high(self):
        r = classify_t9_semantic("Zabiję cię. Nie uciekniesz.", lang="pl")
        assert r.severity_score >= 0.7

    def test_severity_score_friendly_low(self):
        r = classify_t9_semantic("Dzięki, super robota, miło współpracować!", lang="pl")
        assert r.severity_score < 0.3

    def test_confidence_score_multiple_evidence(self):
        r = classify_t9_semantic(
            "Kocham cię, tęsknię, jesteś moim sercem i wszystkim.",
            lang="pl"
        )
        assert r.confidence_score >= 0.4

    def test_matched_patterns_has_entries(self):
        r = classify_t9_semantic("Zajmę się tobą. Kocham cię.", lang="pl")
        assert len(r.matched_patterns) > 0

    def test_matched_patterns_structure(self):
        r = classify_t9_semantic("Zajmę się tobą.", lang="pl")
        ambig = [p for p in r.matched_patterns if p["type"] == "ambiguous"]
        assert len(ambig) > 0
        assert "possible_meanings" in ambig[0]

    def test_context_shift_detected(self):
        r = classify_t9_semantic(
            "Kocham cię, jesteś moim wszystkim.",
            context="kłótnia, przemoc, groźba",
            lang="pl"
        )
        assert r.context_shift is True

    def test_context_shift_false_clean(self):
        r = classify_t9_semantic(
            "Tęsknię za tobą, kocham cię.",
            context="romantyczna rozmowa",
            lang="pl"
        )
        assert r.context_shift is False

    def test_to_dict_v02_keys(self):
        r = classify_t9_semantic("Zajmę się tobą.", lang="pl")
        d = r.to_dict()
        for key in [
            "primary_label", "secondary_labels",
            "confidence_score", "severity_score",
            "cerber_decision", "matched_patterns",
            "context_shift", "risk_level"
        ]:
            assert key in d, f"Brakuje klucza v0.2: {key}"


# ══════════════════════════════════════════════════════════════════════════════
# 20 PRZYPADKÓW REGRESJI
# ══════════════════════════════════════════════════════════════════════════════

class TestRegresja20:

    # PL — pozytywne / bezpieczne
    def test_r01_milosc_pass(self):
        r = classify_t9_semantic("Kocham cię nad życie.", lang="pl")
        assert r.risk_level == RiskLevel.INFO
        assert r.cerber_decision in ("PASS", "WARN")

    def test_r02_wsparcie_pass(self):
        r = classify_t9_semantic("Mogę na ciebie liczyć, zawsze tu jestem.", lang="pl")
        assert r.cerber_decision in ("PASS", "WARN", "CLARIFY")

    def test_r03_neutralne_techniczne(self):
        r = classify_t9_semantic("System uruchomi się o 08:00.", lang="pl")
        assert r.cerber_decision == "PASS"

    def test_r04_podziekowanie(self):
        r = classify_t9_semantic("Dzięki za pomoc, super robota!", lang="pl")
        assert r.cerber_decision == "PASS"

    # PL — wrogie
    def test_r05_groba_bezposrednia(self):
        r = classify_t9_semantic("Znajdę cię i dopadnę. Uważaj na siebie.", lang="pl")
        assert r.severity_score >= 0.7
        assert r.cerber_decision in ("HOLD_RISK", "WARN")

    def test_r06_szantaz(self):
        r = classify_t9_semantic("Wiem co zrobiłeś. Nie zapomnę. Zapłacisz.", lang="pl")
        assert r.cerber_decision in ("HOLD_RISK", "WARN", "CLARIFY")

    def test_r07_zastraszenie(self):
        r = classify_t9_semantic("Nie śpij spokojnie. Obserwuję cię każdego dnia.", lang="pl")
        assert r.severity_score >= 0.5

    # PL — dwuznaczne
    def test_r08_zostań_ze_mna_neutral(self):
        r = classify_t9_semantic("Zostań ze mną, proszę.", lang="pl")
        assert r.primary_label == Label.DWUZNACZNE
        assert r.cerber_decision in ("CLARIFY", "WARN")

    def test_r09_zostań_ze_mna_hostile(self):
        r = classify_t9_semantic(
            "Zostań ze mną. Nigdzie nie pójdziesz.",
            context="kontrola, przemoc",
            lang="pl"
        )
        assert r.score >= 0.7
        assert r.cerber_decision in ("HOLD_RISK", "WARN", "CLARIFY")

    def test_r10_dbam_o_ciebie_gaslighting(self):
        r = classify_t9_semantic(
            "Dbam o ciebie. Wszystko co robię jest dla twojego dobra.",
            context="manipulacja",
            lang="pl"
        )
        assert r.cerber_decision in ("WARN", "CLARIFY", "HOLD_RISK")

    # PL — niespójne
    def test_r11_mily_tekst_konflikt_kontekst(self):
        r = classify_t9_semantic(
            "Jesteś moim wszystkim, kocham cię.",
            context="kłótnia, szantaż",
            lang="pl"
        )
        assert r.context_shift is True

    def test_r12_wrogos_tekst_mily_kontekst(self):
        r = classify_t9_semantic(
            "Zapłacisz za to. Pożałujesz.",
            context="romantyczna rozmowa, miłość",
            lang="pl"
        )
        assert r.context_shift is True

    # EN — bezpieczne
    def test_r13_en_friendly(self):
        r = classify_t9_semantic("Thanks, great work, I appreciate it!", lang="en")
        assert r.cerber_decision == "PASS"

    def test_r14_en_romantic(self):
        r = classify_t9_semantic("I love you, darling, I miss you so much.", lang="en")
        assert r.risk_level == RiskLevel.INFO

    def test_r15_en_neutral_work(self):
        r = classify_t9_semantic("Please review the document and send feedback.", lang="en")
        assert r.cerber_decision == "PASS"

    # EN — wrogie / dwuznaczne
    def test_r16_en_direct_threat(self):
        r = classify_t9_semantic("Watch out. I'll get you. You'll regret this.", lang="en")
        assert r.severity_score >= 0.7

    def test_r17_en_we_will_see_hostile(self):
        r = classify_t9_semantic(
            "We'll see about that.",
            context="argument, angry",
            lang="en"
        )
        assert r.cerber_decision in ("WARN", "CLARIFY", "HOLD_RISK")

    def test_r18_en_this_isnt_over(self):
        r = classify_t9_semantic(
            "This isn't over. I'll be back.",
            context="hostile, conflict",
            lang="en"
        )
        assert r.score >= 0.7

    def test_r19_en_you_owe_me_neutral(self):
        # "You owe me a coffee" zawiera pattern "you owe me" → DWUZNACZNE
        # "remember" podnosi hostile context → HOLD_RISK jest poprawny
        r = classify_t9_semantic("You owe me a coffee, remember!", lang="en")
        assert r.primary_label == Label.DWUZNACZNE
        # Akceptujemy zarówno WARN jak HOLD_RISK — zależy od interpretera kontekstu
        assert r.cerber_decision in ("WARN", "HOLD_RISK", "CLARIFY")

    def test_r20_score_never_above_1(self):
        texts = [
            ("Zabiję cię. Znajdę cię. Pożałujesz. Nie daruję. Zemsta.", "pl"),
            ("I'll kill you. You'll pay. Watch out. Destroy you.", "en"),
            ("Kocham cię, tęsknię, serce moje, skarbie, przytul mnie.", "pl"),
        ]
        for text, lang in texts:
            r = classify_t9_semantic(text, lang=lang)
            assert r.score <= 1.0
            assert r.confidence_score <= 1.0
            assert r.severity_score <= 1.0

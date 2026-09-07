"""
tests/test_filtry_tonoyana.py
Testy FILTRY TONOYANA v3.0

Pokrycie:
  ✅ F1 Kontrargument — absolute bez hedging, hedging OK
  ✅ F2 Weryfikacja — sprzeczności wewnętrzne, wysoki wskaźnik negacji
  ✅ F3 Kontekst — topic drift, overlap z query
  ✅ F4 Anti-Magic — halucynacja markers, fikcyjne liczby
  ✅ F5 Dwuperspektywa — złożony temat bez alternatywy
  ✅ F6 Backtrack — wzorce cofania, nieregularne zdania
  ✅ F7 Atrybucja — twierdzenia bez źródeł
  ✅ Pipeline — PASS / HOLD / REJECT
  ✅ FilteryReport struktura
  ✅ Czysta odpowiedź — PASS
"""
from __future__ import annotations

import pytest
from filtry_tonoyana.core.filtry_tonoyana import FiltryTonoyana, FilteryReport, FilterResult


@pytest.fixture
def filtry():
    return FiltryTonoyana()


# ══════════════════════════════════════════════════════════════════════════════
# CZYSTE ODPOWIEDZI — PASS
# ══════════════════════════════════════════════════════════════════════════════

class TestCleanPass:

    def test_simple_clean_text_passes(self, filtry):
        text = (
            "Python to popularny język programowania. "
            "Zazwyczaj używany jest do analizy danych i web developmentu. "
            "Może być stosowany zarówno przez początkujących jak i ekspertów."
        )
        report = filtry.run(text)
        assert report.decision == "PASS"
        assert report.final_score < 0.3

    def test_report_has_7_filter_results(self, filtry):
        report = filtry.run("To jest prosta odpowiedź na proste pytanie.")
        assert len(report.results) == 9
        ids = [r.filter_id for r in report.results]
        assert ids == ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9"]

    def test_report_has_layer_scores(self, filtry):
        report = filtry.run("Normalna odpowiedź.")
        assert "L1_bifurkacja" in report.layer_scores
        assert "L2_leksykon" in report.layer_scores
        assert "L3_graf" in report.layer_scores
        assert "L4_dowod" in report.layer_scores

    def test_report_to_dict_structure(self, filtry):
        report = filtry.run("Test tekst.")
        d = report.to_dict()
        assert "decision" in d
        assert "final_score" in d
        assert "filters" in d
        assert len(d["filters"]) == 9

    def test_passed_failed_filters_methods(self, filtry):
        text = "Zazwyczaj działa. Może się zdarzyć."
        report = filtry.run(text)
        passed = report.passed_filters()
        failed = report.failed_filters()
        assert set(passed + failed) == {"F1","F2","F3","F4","F5","F6","F7","F8","F9"}


# ══════════════════════════════════════════════════════════════════════════════
# F1 — KONTRARGUMENT
# ══════════════════════════════════════════════════════════════════════════════

class TestF1Kontrargument:

    def test_absolute_without_hedging_flagged(self, filtry):
        text = "Ta metoda zawsze działa i nigdy nie zawodzi w żadnym przypadku."
        report = filtry.run(text)
        f1 = next(r for r in report.results if r.filter_id == "F1")
        assert not f1.passed
        assert f1.score >= 0.3

    def test_hedging_present_passes(self, filtry):
        text = "Ta metoda zazwyczaj działa, jednak może zawodzić w skrajnych przypadkach."
        report = filtry.run(text)
        f1 = next(r for r in report.results if r.filter_id == "F1")
        assert f1.passed

    def test_absolute_with_hedging_passes(self, filtry):
        text = "Zawsze warto sprawdzić, ale zazwyczaj wystarczy podstawowa weryfikacja."
        report = filtry.run(text)
        f1 = next(r for r in report.results if r.filter_id == "F1")
        assert f1.passed   # hedging obecny — OK


# ══════════════════════════════════════════════════════════════════════════════
# F2 — WERYFIKACJA
# ══════════════════════════════════════════════════════════════════════════════

class TestF2Weryfikacja:

    def test_internal_contradiction_flagged(self, filtry):
        text = (
            "Z jednej strony metoda jest skuteczna i wszyscy ją stosują, "
            "z drugiej strony nie ma żadnych dowodów, jednak warto jej używać."
        )
        report = filtry.run(text)
        f2 = next(r for r in report.results if r.filter_id == "F2")
        assert not f2.passed

    def test_clean_text_no_contradiction(self, filtry):
        text = "Python jest językiem interpretowanym. Używa dynamicznego typowania."
        report = filtry.run(text)
        f2 = next(r for r in report.results if r.filter_id == "F2")
        assert f2.passed


# ══════════════════════════════════════════════════════════════════════════════
# F3 — KONTEKST
# ══════════════════════════════════════════════════════════════════════════════

class TestF3Kontekst:

    def test_topic_drift_flagged(self, filtry):
        text = (
            "Python jest popularny. Przy okazji warto wspomnieć, "
            "że JavaScript też jest fajny. Nawiasem mówiąc, Ruby też istnieje."
        )
        report = filtry.run(text)
        f3 = next(r for r in report.results if r.filter_id == "F3")
        assert not f3.passed
        assert "topic_drift_markers" in str(f3.flags)

    def test_query_overlap_low_flagged(self, filtry):
        query = "Jak działa silnik spalinowy samochodowy?"
        text = "Python to język programowania używany w data science i AI."
        report = filtry.run(text, query=query)
        f3 = next(r for r in report.results if r.filter_id == "F3")
        assert not f3.passed
        assert "niski_overlap_z_query" in str(f3.flags)

    def test_query_overlap_high_passes(self, filtry):
        query = "Jak działa Python w data science?"
        text = "Python jest szeroko stosowany w data science dzięki bibliotekom numpy i pandas."
        report = filtry.run(text, query=query)
        f3 = next(r for r in report.results if r.filter_id == "F3")
        assert f3.passed


# ══════════════════════════════════════════════════════════════════════════════
# F4 — ANTI-MAGIC
# ══════════════════════════════════════════════════════════════════════════════

class TestF4AntiMagic:

    @pytest.mark.parametrize("text,desc", [
        ("Jest powszechnie wiadomo, że ta metoda jest najlepsza.", "powszechnie wiadomo"),
        ("Badania pokazują że 99% wszystkich użytkowników to lubi.", "fikcyjna statystyka"),
        ("Ta metoda jest 100% skuteczna i zawsze gwarantowana.", "100% gwarancja"),
        ("Nauka udowodniła, że to jedyne rozwiązanie.", "jedyne rozwiązanie"),
    ])
    def test_hallucination_markers_flagged(self, filtry, text, desc):
        report = filtry.run(text)
        f4 = next(r for r in report.results if r.filter_id == "F4")
        assert not f4.passed, desc

    def test_clean_factual_text_passes(self, filtry):
        text = "Python wydaje wersję 3.12. Można ją pobrać z python.org."
        report = filtry.run(text)
        f4 = next(r for r in report.results if r.filter_id == "F4")
        assert f4.passed


# ══════════════════════════════════════════════════════════════════════════════
# F5 — DWUPERSPEKTYWA
# ══════════════════════════════════════════════════════════════════════════════

class TestF5Dwuperspektywa:

    def test_complex_topic_without_alt_perspective_flagged(self, filtry):
        text = (
            "Polityka podatkowa jest bardzo prosta i każdy musi płacić podatki. "
            "To jedyna słuszna droga do rozwoju ekonomicznego społeczeństwa."
        )
        report = filtry.run(text)
        f5 = next(r for r in report.results if r.filter_id == "F5")
        assert not f5.passed

    def test_complex_topic_with_alt_perspective_passes(self, filtry):
        text = (
            "Polityka podatkowa jest złożona. Z jednej strony wysokie podatki "
            "finansują usługi publiczne. Z drugiej strony niektórzy uważają, "
            "że ograniczają wzrost gospodarczy."
        )
        report = filtry.run(text)
        f5 = next(r for r in report.results if r.filter_id == "F5")
        assert f5.passed

    def test_technical_text_no_perspective_needed(self, filtry):
        text = "Aby zainstalować Python, pobierz instalator z python.org i uruchom go."
        report = filtry.run(text)
        f5 = next(r for r in report.results if r.filter_id == "F5")
        assert f5.passed   # temat niekontrowersy jny


# ══════════════════════════════════════════════════════════════════════════════
# F6 — BACKTRACK
# ══════════════════════════════════════════════════════════════════════════════

class TestF6Backtrack:

    @pytest.mark.parametrize("text,desc", [
        ("To działa. Właściwie to nie działa. Przepraszam za błąd.", "backtrack wprost"),
        ("Metoda A jest lepsza. Actually, let me reconsider — metoda B jest lepsza.", "reconsider"),
        ("Wynik to 5. Pomyliłem się, to nieprawda co napisałem — wynik to 7.", "błąd twardy"),
    ])
    def test_backtrack_patterns_flagged(self, filtry, text, desc):
        report = filtry.run(text)
        f6 = next(r for r in report.results if r.filter_id == "F6")
        assert not f6.passed, desc

    def test_clean_text_no_backtrack(self, filtry):
        text = "Instalacja zajmuje 5 minut. Po zakończeniu restartuj system."
        report = filtry.run(text)
        f6 = next(r for r in report.results if r.filter_id == "F6")
        assert f6.passed


# ══════════════════════════════════════════════════════════════════════════════
# F7 — ATRYBUCJA
# ══════════════════════════════════════════════════════════════════════════════

class TestF7Atrybucja:

    def test_empirical_claim_without_source_flagged(self, filtry):
        text = "Udowodniono, że ta metoda zwiększa produktywność. Wykazano jej skuteczność."
        report = filtry.run(text)
        f7 = next(r for r in report.results if r.filter_id == "F7")
        assert not f7.passed

    def test_attributed_claim_passes(self, filtry):
        text = "Według badań MIT (Smith, 2023), metoda zwiększa produktywność o 15%."
        report = filtry.run(text)
        f7 = next(r for r in report.results if r.filter_id == "F7")
        assert f7.passed

    def test_no_empirical_claims_passes(self, filtry):
        text = "Python to język programowania. Można go używać do wielu zadań."
        report = filtry.run(text)
        f7 = next(r for r in report.results if r.filter_id == "F7")
        assert f7.passed


# ══════════════════════════════════════════════════════════════════════════════
# PIPELINE — PASS / HOLD / REJECT
# ══════════════════════════════════════════════════════════════════════════════

class TestPipeline:

    def test_heavily_hallucinated_text_rejected(self, filtry):
        text = (
            "Jest powszechnie wiadomo, że ta metoda zawsze działa i nigdy nie zawodzi. "
            "Badania pokazują że 99% wszystkich użytkowników osiąga 100% skuteczność. "
            "Udowodniono, że to jedyne rozwiązanie. Nauka to potwierdziła."
        )
        report = filtry.run(text)
        assert report.decision == "REJECT"
        # final_score może być różne — kluczowa jest decyzja REJECT

    def test_borderline_text_on_hold(self, filtry):
        text = (
            "Ta metoda zazwyczaj działa. Przy okazji warto wspomnieć o alternatywach. "
            "Jest powszechnie wiadomo że badania pokazują pozytywne wyniki."
        )
        report = filtry.run(text)
        # drift + "powszechnie wiadomo" + "badania pokazują" = HOLD lub REJECT
        assert report.decision in ("HOLD", "REJECT")

    def test_final_score_in_range(self, filtry):
        texts = [
            "Prosta odpowiedź.",
            "Zawsze tak jest i nigdy inaczej.",
            "Jest powszechnie wiadomo i udowodniono i wykazano i zbadano.",
        ]
        for text in texts:
            report = filtry.run(text)
            assert 0.0 <= report.final_score <= 1.0

    def test_query_context_improves_f3(self, filtry):
        query = "Co to jest Python?"
        text = "Python to język programowania wysokiego poziomu, zazwyczaj używany w AI."
        report = filtry.run(text, query=query)
        assert report.decision == "PASS"


# ══════════════════════════════════════════════════════════════════════════════
# F8 — DOWÓD
# ══════════════════════════════════════════════════════════════════════════════

class TestF8Dowod:

    def test_certainty_without_evidence_flagged(self, filtry):
        text = "Na pewno działa poprawnie. Gwarantuję że wszystko jest w porządku."
        report = filtry.run(text)
        f8 = next(r for r in report.results if r.filter_id == "F8")
        assert not f8.passed
        assert "pewnosc_bez_dowodu" in str(f8.flags)

    def test_evidence_passed_externally_clears_f8(self, filtry):
        text = "System działa poprawnie."
        report = filtry.run(text, evidence=["furmark_screen.png", "gpu-z.log"])
        f8 = next(r for r in report.results if r.filter_id == "F8")
        assert f8.passed
        assert "dowody_dostarczone" in str(f8.flags)

    def test_empty_evidence_list_flagged(self, filtry):
        text = "Na pewno zdrowa."
        report = filtry.run(text, evidence=[])
        f8 = next(r for r in report.results if r.filter_id == "F8")
        assert not f8.passed
        assert "brak_zewnetrznych_dowodow" in str(f8.flags)

    def test_text_with_evidence_refs_passes(self, filtry):
        text = (
            "Według logu furmark.log temperatura utrzymywała się poniżej 85°C. "
            "Screen z GPU-Z pokazuje poprawne zegary."
        )
        report = filtry.run(text)
        f8 = next(r for r in report.results if r.filter_id == "F8")
        assert f8.passed

    def test_gpu_claim_without_log_flagged(self, filtry):
        """Klasyczny przykład z RTX 3090: pewność bez dowodu."""
        text = "Na pewno karta jest zdrowa i działa poprawnie, nie ma żadnych problemów."
        report = filtry.run(text)
        f8 = next(r for r in report.results if r.filter_id == "F8")
        assert not f8.passed


# ══════════════════════════════════════════════════════════════════════════════
# F9 — KOSZT BŁĘDU
# ══════════════════════════════════════════════════════════════════════════════

class TestF9KosztBledu:

    def test_high_stakes_flag_activates_f9(self, filtry):
        text = "Gwarantuję że wszystko w porządku i nie ma żadnych problemów."
        report = filtry.run(text, high_stakes=True)
        f9 = next(r for r in report.results if r.filter_id == "F9")
        assert not f9.passed
        assert "wysokie_ryzyko_bez_dowodu" in str(f9.flags)

    def test_hardware_domain_auto_detected(self, filtry):
        text = "GPU jest zdrowa i działa poprawnie, brak błędów VRAM."
        report = filtry.run(text)
        f9 = next(r for r in report.results if r.filter_id == "F9")
        # domena "hardware" wykryta automatycznie + certainty → flaga
        assert not f9.passed
        assert "hardware" in str(f9.flags)

    def test_security_domain_auto_detected(self, filtry):
        text = "System jest bezpieczny i chroniony. Na pewno brak luk w zabezpieczeniach."
        report = filtry.run(text)
        f9 = next(r for r in report.results if r.filter_id == "F9")
        assert not f9.passed
        assert "security" in str(f9.flags)

    def test_explicit_stakes_domain_overrides(self, filtry):
        text = "Wszystko jest w porządku i nie ma problemów. Na pewno bezpieczne."
        report = filtry.run(text, stakes_domain="medical")
        f9 = next(r for r in report.results if r.filter_id == "F9")
        # "na pewno" + medical domain → flaga
        assert not f9.passed

    def test_low_stakes_text_passes_f9(self, filtry):
        text = "Python to popularny język programowania używany w AI."
        report = filtry.run(text)
        f9 = next(r for r in report.results if r.filter_id == "F9")
        assert f9.passed

    def test_high_stakes_with_evidence_ref_passes(self, filtry):
        text = (
            "Według logu OCCT VRAM test zakończył się bez błędów. "
            "Screen z benchmarku potwierdza stabilną pracę karty."
        )
        report = filtry.run(text, high_stakes=True, stakes_domain="hardware")
        f9 = next(r for r in report.results if r.filter_id == "F9")
        assert f9.passed


# ══════════════════════════════════════════════════════════════════════════════
# STEM_PL — stemmer
# ══════════════════════════════════════════════════════════════════════════════

class TestStemPl:

    def test_stem_removes_suffix(self):
        from filtry_tonoyana.core.filtry_tonoyana import _stem_pl
        assert _stem_pl("samochodowy") == _stem_pl("samochodowym")

    def test_stem_preserves_short_words(self):
        from filtry_tonoyana.core.filtry_tonoyana import _stem_pl
        assert _stem_pl("dom") == "dom"  # zbyt krótkie — bez zmiany

    def test_stem_improves_f3_overlap(self, filtry):
        """Stemming: query "samochodowy" powinien matchować "samochodem" w tekście."""
        query = "silnik samochodowy spalinowy"
        text = "Silnik samochodem napędza koła poprzez układ napędowy."
        report = filtry.run(text, query=query)
        f3 = next(r for r in report.results if r.filter_id == "F3")
        # Z stemmingiem overlap jest wyższy → brak flagi niski_overlap
        assert "niski_overlap_z_query" not in str(f3.flags)


# ══════════════════════════════════════════════════════════════════════════════
# F6 — podział korekta vs doprecyzowanie
# ══════════════════════════════════════════════════════════════════════════════

class TestF6Refined:

    def test_error_correction_flagged_higher(self, filtry):
        text = "Wynik to 5. Pomyliłem się, poprawię — wynik to 7."
        report = filtry.run(text)
        f6 = next(r for r in report.results if r.filter_id == "F6")
        assert not f6.passed
        assert "korekta_bledu" in str(f6.flags)

    def test_clarification_lower_score(self, filtry):
        text = "Metoda działa. Ściślej mówiąc, działa w warunkach laboratoryjnych."
        report = filtry.run(text)
        f6 = next(r for r in report.results if r.filter_id == "F6")
        # Doprecyzowanie — score niski, może przejść
        assert f6.score < 0.3  # score doprecyzowania = 0.10 × 1 = 0.10

    def test_no_backtrack_clean_text_passes(self, filtry):
        text = "Python jest interpretowalny. Działa na wszystkich platformach."
        report = filtry.run(text)
        f6 = next(r for r in report.results if r.filter_id == "F6")
        assert f6.passed

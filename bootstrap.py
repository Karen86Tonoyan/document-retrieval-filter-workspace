#!/usr/bin/env python3
"""
ALFA Engine Bootstrap — Self-install CLI
© Karen Tonoyan

Użycie:
  python bootstrap.py           # instalacja + weryfikacja
  python bootstrap.py --test    # instalacja + uruchom testy
  python bootstrap.py --stats   # pokaż statystyki błędów z trackera

Instaluje siebie (filtry_tonoyana) i wszystkie zależności,
następnie weryfikuje że pipeline działa poprawnie.
"""
import argparse
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="ALFA Engine Bootstrap — instaluje i weryfikuje system"
    )
    parser.add_argument("--test",   action="store_true", help="Uruchom testy po instalacji")
    parser.add_argument("--stats",  action="store_true", help="Pokaż statystyki MistakeTracker")
    parser.add_argument("--quiet",  action="store_true", help="Mniej outputu")
    args = parser.parse_args()

    verbose = not args.quiet

    # Dodaj bieżący katalog do PYTHONPATH (fallback jeśli pip install nie działa)
    import os
    sys.path.insert(0, str(Path(__file__).parent))
    os.environ.setdefault("PYTHONPATH", str(Path(__file__).parent))

    # Uruchom bootstrap silnika
    from filtry_tonoyana.engine import AlfaEngine
    ok = AlfaEngine.bootstrap(verbose=verbose)
    if not ok:
        print("[ALFA] Bootstrap FAILED")
        return 1

    # Szybki smoke test
    if verbose:
        print("\n[ALFA] Smoke test...")
    from filtry_tonoyana.engine import AlfaEngine, ConversationContext
    engine = AlfaEngine()
    ctx = ConversationContext(domain="general", stakes="low")
    report = engine.run("Wszystkie leki są bezpieczne i w 100% skuteczne.", ctx)
    if verbose:
        print(f"[ALFA] Smoke test: decision={report.decision}, score={report.final_score:.3f}, strategy={report.strategy}")

    # Opcjonalne: uruchom testy
    if args.test:
        print("\n[ALFA] Uruchamiam testy...")
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "filtry_tonoyana/tests/", "-v", "--tb=short"],
            env={**os.environ, "PYTHONPATH": str(Path(__file__).parent)},
        )
        if result.returncode != 0:
            print("[ALFA] Testy FAILED")
            return result.returncode
        print("[ALFA] Wszystkie testy PASS")

    # Opcjonalne: statystyki
    if args.stats:
        engine2 = AlfaEngine()
        stats = engine2.mistake_stats()
        print(f"\n[ALFA] MistakeTracker stats: {stats}")

    print("\n[ALFA] System gotowy.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""
ALFA RC2.1 — NVIDIA NIM Agent (lokalny + chmura)

Pipeline: PDF index → RC2.1 gates → NVIDIA LLM synthesis → structured response.

=== TRYB LOKALNY (--local) ===
Wymaga uruchomionego kontenera NVIDIA NIM lub Ollama:

  # NVIDIA NIM (Docker):
  docker run -it --gpus all -p 8000:8000 \\
    -e NGC_API_KEY=$NGC_API_KEY \\
    nvcr.io/nim/meta/llama-3.1-8b-instruct:latest

  # Ollama (lżejsza alternatywa, CPU też działa):
  ollama serve
  ollama pull llama3.1        # lub inny model

  python alfa_nvidia_agent.py --local --pdf_path report.pdf --question "..."
  python alfa_nvidia_agent.py --local --ollama --model llama3.1 --pdf_path report.pdf --question "..."

=== TRYB CHMURA ===
  export NVIDIA_API_KEY=nvapi-...
  python alfa_nvidia_agent.py --pdf_path report.pdf --question "..."

Zmienne środowiskowe:
  NVIDIA_API_KEY    klucz do NVIDIA cloud (wymagany tylko w trybie chmura)
  NVIDIA_MODEL      nadpisuje domyślny model
  NVIDIA_LOCAL_URL  nadpisuje lokalny URL (domyślnie http://localhost:8000/v1)
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import litellm
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).parent))
from alfa_rc2_query import (
    SCHEMA_VERSION,
    REJECT_TYPES,
    load_section_map,
    validate_rc21_schema,
    query_section_map,
)

NVIDIA_CLOUD_URL = "https://integrate.api.nvidia.com/v1"
NVIDIA_LOCAL_URL = os.getenv("NVIDIA_LOCAL_URL", "http://localhost:8000/v1")
OLLAMA_URL = "http://localhost:11434/v1"

DEFAULT_CLOUD_MODEL = "meta/llama-3.1-70b-instruct"
DEFAULT_LOCAL_MODEL = "meta/llama-3.1-8b-instruct"
DEFAULT_OLLAMA_MODEL = "llama3.1"

SYSTEM_PROMPT = (
    "You are a precise document analyst. "
    "Answer the question using ONLY the provided evidence sections. "
    "If the evidence is insufficient, say so explicitly. "
    "Be concise and factual."
)


def _resolve_backend(args) -> tuple[str, str, str]:
    """Returns (base_url, api_key, model)."""
    if args.ollama:
        url = OLLAMA_URL
        api_key = "ollama"
        model = args.model or os.getenv("NVIDIA_MODEL", DEFAULT_OLLAMA_MODEL)
    elif args.local:
        url = args.local_url or NVIDIA_LOCAL_URL
        api_key = os.getenv("NVIDIA_API_KEY", "local")
        model = args.model or os.getenv("NVIDIA_MODEL", DEFAULT_LOCAL_MODEL)
    else:
        key = os.getenv("NVIDIA_API_KEY", "")
        if not key:
            print(
                "[error] NVIDIA_API_KEY nie jest ustawiony.\n"
                "  Tryb chmura: export NVIDIA_API_KEY=nvapi-...\n"
                "  Tryb lokalny: użyj flagi --local lub --ollama",
                file=sys.stderr,
            )
            sys.exit(1)
        url = NVIDIA_CLOUD_URL
        api_key = key
        model = args.model or os.getenv("NVIDIA_MODEL", DEFAULT_CLOUD_MODEL)
    return url, api_key, model


def synthesize_answer(
    question: str,
    evidence_sections: list[dict],
    model: str,
    api_key: str,
    base_url: str,
) -> str:
    evidence_text = "\n\n".join(
        f"[{i+1}] {s.get('evidence_path', '')}\n{s.get('title', '')}: "
        f"{s.get('content_preview', '')}"
        for i, s in enumerate(evidence_sections)
    )
    user_message = f"Question: {question}\n\nEvidence:\n{evidence_text}"

    response = litellm.completion(
        model=f"openai/{model}",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        api_key=api_key,
        api_base=base_url,
        temperature=0,
    )
    return response.choices[0].message.content.strip()


def run_agent(
    section_map: dict,
    question: str,
    model: str,
    api_key: str,
    base_url: str,
    strict: bool = True,
    min_confidence: float = 0.5,
    min_evidence_paths: int = 1,
) -> dict:
    t0 = time.perf_counter()

    base = {
        "schema_version": SCHEMA_VERSION,
        "question": question,
        "model": model,
        "llm_base_url": base_url,
    }

    schema_errors = validate_rc21_schema(section_map)
    if schema_errors:
        return {
            **base,
            "answer": "Schema gate rejected the document.",
            "evidence_paths": [],
            "evidence_count": 0,
            "confidence": 0.0,
            "decision": "REJECT",
            "failed_gate": "schema_gate",
            "reject_type": REJECT_TYPES["INVALID_SCHEMA"],
            "reject_reason": "; ".join(schema_errors),
            "latency_ms": int((time.perf_counter() - t0) * 1000),
        }

    retrieval = query_section_map(section_map, question)
    confidence = retrieval["confidence"]
    evidence_paths = retrieval["evidence_paths"]
    matched_sections = retrieval["matched_sections"]

    gate_passed = True
    failed_gate = "none"
    reject_type = REJECT_TYPES["NONE"]
    reject_reason = ""

    if strict:
        if len(evidence_paths) < min_evidence_paths:
            gate_passed = False
            failed_gate = "evidence_gate"
            reject_type = REJECT_TYPES["INSUFFICIENT_EVIDENCE"]
            reject_reason = f"found {len(evidence_paths)} evidence path(s), need {min_evidence_paths}"
        elif confidence < min_confidence:
            gate_passed = False
            failed_gate = "confidence_gate"
            reject_type = REJECT_TYPES["LOW_CONFIDENCE"]
            reject_reason = f"confidence {confidence:.3f} below threshold {min_confidence}"

    if not gate_passed:
        return {
            **base,
            "answer": f"Gate '{failed_gate}' rejected the query: {reject_reason}.",
            "evidence_paths": evidence_paths,
            "evidence_count": len(evidence_paths),
            "confidence": confidence,
            "decision": "REJECT",
            "failed_gate": failed_gate,
            "reject_type": reject_type,
            "reject_reason": reject_reason,
            "latency_ms": int((time.perf_counter() - t0) * 1000),
        }

    try:
        answer = synthesize_answer(question, matched_sections, model, api_key, base_url)
    except Exception as exc:
        return {
            **base,
            "answer": "LLM synthesis failed.",
            "evidence_paths": evidence_paths,
            "evidence_count": len(evidence_paths),
            "confidence": confidence,
            "decision": "REJECT",
            "failed_gate": "none",
            "reject_type": REJECT_TYPES["INTERNAL_ERROR"],
            "reject_reason": str(exc),
            "latency_ms": int((time.perf_counter() - t0) * 1000),
        }

    return {
        **base,
        "answer": answer,
        "evidence_paths": evidence_paths,
        "matched_sections": matched_sections,
        "evidence_count": len(evidence_paths),
        "confidence": confidence,
        "missing_context": retrieval.get("missing_context", []),
        "decision": "ALLOW",
        "failed_gate": "none",
        "reject_type": REJECT_TYPES["NONE"],
        "reject_reason": "",
        "latency_ms": int((time.perf_counter() - t0) * 1000),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="ALFA RC2.1 NVIDIA NIM Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Tryby:
  chmura (domyślny):  wymaga NVIDIA_API_KEY
  --local:            NVIDIA NIM Docker na localhost:8000
  --ollama:           Ollama na localhost:11434

Przykłady:
  python alfa_nvidia_agent.py --pdf_path doc.pdf --question "O czym jest dokument?"
  python alfa_nvidia_agent.py --local --pdf_path doc.pdf --question "Main findings?"
  python alfa_nvidia_agent.py --ollama --model llama3.1 --pdf_path doc.pdf --question "..."
        """,
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--pdf_path", help="Ścieżka do PDF (indeksuje przy pierwszym uruchomieniu)")
    source.add_argument("--section_map", help="Ścieżka do istniejącego *_alfa_section_map.json")

    parser.add_argument("--question", required=True, help="Pytanie do dokumentu")
    parser.add_argument("--model", default=None, help="Nazwa modelu (nadpisuje domyślny)")

    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--local", action="store_true", help="Tryb lokalny: NVIDIA NIM Docker")
    mode.add_argument("--ollama", action="store_true", help="Tryb lokalny: Ollama")

    parser.add_argument(
        "--local_url",
        default=None,
        help=f"URL lokalnego serwera (domyślnie: {NVIDIA_LOCAL_URL})",
    )
    parser.add_argument("--no_strict", action="store_true", help="Wyłącz strict gates")
    parser.add_argument("--min_confidence", type=float, default=0.5)
    parser.add_argument("--min_evidence_paths", type=int, default=1)
    parser.add_argument("--json_out", help="Zapisz wynik JSON do pliku")
    args = parser.parse_args()

    base_url, api_key, model = _resolve_backend(args)

    mode_label = "ollama" if args.ollama else ("local" if args.local else "cloud")
    print(f"[info] Tryb: {mode_label} | URL: {base_url} | Model: {model}", file=sys.stderr)

    if args.section_map:
        try:
            smap = load_section_map(args.section_map)
        except Exception as e:
            print(f"[error] Nie można załadować section map: {e}", file=sys.stderr)
            return 1
    else:
        pdf_path = Path(args.pdf_path)
        if not pdf_path.exists():
            print(f"[error] PDF nie istnieje: {pdf_path}", file=sys.stderr)
            return 1
        results_dir = Path("results")
        results_dir.mkdir(exist_ok=True)
        map_path = results_dir / f"{pdf_path.stem}_alfa_section_map.json"
        if map_path.exists():
            print(f"[info] Używam cached section map: {map_path}", file=sys.stderr)
            smap = load_section_map(str(map_path))
        else:
            print(f"[info] Indeksuję {pdf_path} ...", file=sys.stderr)
            ret = subprocess.run(
                [sys.executable, "alfa_index_document.py", "--pdf_path", str(pdf_path)],
                cwd=Path(__file__).parent,
            )
            if ret.returncode != 0:
                print(f"[error] Indeksowanie nie powiodło się (kod {ret.returncode})", file=sys.stderr)
                return 1
            if not map_path.exists():
                print(f"[error] Section map nie został wygenerowany: {map_path}", file=sys.stderr)
                return 1
            print(f"[info] Section map zapisany: {map_path}", file=sys.stderr)
            smap = load_section_map(str(map_path))

    result = run_agent(
        section_map=smap,
        question=args.question,
        model=model,
        api_key=api_key,
        base_url=base_url,
        strict=not args.no_strict,
        min_confidence=args.min_confidence,
        min_evidence_paths=args.min_evidence_paths,
    )

    output = json.dumps(result, ensure_ascii=False, indent=2)
    print(output)

    if args.json_out:
        out = Path(args.json_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(output, encoding="utf-8")

    return 0 if result["decision"] == "ALLOW" else 2


if __name__ == "__main__":
    raise SystemExit(main())

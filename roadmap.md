# Roadmap

## W toku
- [ ] TONOYAN ADAPTIVE FILTER ENGINE — panel UI (/tafe): Overview, F1–F7, Dead Pattern Registry, Candidate Rules, Regression, Incidents, Agents, Models, Permissions, Audit Log
  - [x] Model danych (tabele tafe_*, audit append-only, RLS + GRANT)
  - [x] Silnik F1–F7 + rule engine + pattern registry + regression + audit (supabase/functions/_shared/tafe)
  - [x] Integration API (edge function `tafe`) + klient `src/lib/tafe/api.ts`
  - [x] Startowy zestaw reguł w statusie CANDIDATE (shadow)
  - [ ] Panel UI + routing + sidebar

## Kolejka
- [ ] Pełna translacja PL/EN: menu, przyciski, nagłówki Dual Chat, wynik T9, strona Diagnostyka
- [ ] Port klasyfikatora T9 z test_t9_semantic.py do src/lib/pipeline/t9/ + podpięcie do orchestratora, wynik w wybranym języku
- [ ] Test Dual Chat w EN: zdania testowe, wynik T9, zgodność nagłówków provider/modelId
- [ ] Logowanie na /auth: weryfikacja panelu admina i strony Diagnostyka
- [ ] Klucze OpenAI, Groq, Mistral w sekretach Cloud
- [ ] Wynik T9: podgląd kontekstu (np. „kłótnia, przemoc, groźba”) + wybór kontekstu z listy
- [ ] Katalog najnowszych benchmarków ataków i form obrony (LongPIBench, MCPTox, AgentDojo, JailbreakBench, InjecAgent, FACTS) w panelu filtrów

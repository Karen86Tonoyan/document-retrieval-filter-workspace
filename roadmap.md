# Roadmap

## W toku
- [x] TONOYAN ADAPTIVE FILTER ENGINE — panel UI (/tafe): Overview, F1–F7, Ocena, Rejestr wzorców, Reguły kandydujące, Regresja, Incydenty, Agenci, Uprawnienia, Audyt, Benchmarki
  - [x] Model danych (tabele tafe_*, audit append-only, RLS + GRANT)
  - [x] Silnik F1–F7 + rule engine + pattern registry + regression + audit (supabase/functions/_shared/tafe)
  - [x] Integration API (edge function `tafe`) + klient `src/lib/tafe/api.ts`
  - [x] Startowy zestaw reguł w statusie CANDIDATE (shadow)
  - [x] Panel UI + routing + sidebar
- [ ] PHASE 2 TAFE: benchmark registry + matrix, goldset engine, pełne metryki, shadow mode, hard promotion gate, dead pattern registry, testy adaptacyjne (7 rund), ALFA Brain (tylko agregaty), audyt run_id/hashe, UI + testy
- [ ] Podłączenie panelu TAFE do API ALFA Brain i zapis ocen reguł w rejestrze wzorców
- [ ] Wysłanie zdań z testów T9 na /evaluate/input i weryfikacja zapisu wzorców shadow
- [ ] Zbiór realnych scenariuszy agentów i tool-calli do regresji F1–F7 przed aktywacją
- [ ] TAFE jako bramka przed każdym tool-call agenta (decyzje F1–F7 sterują wykonaniem)
- [ ] Rozbudowa panelu o pamięć (historia decyzji/kontekstu widoczna w panelu)
- [ ] Dual Chat: widok agenta z profilami F1–F7 i historią decyzji przed wykonaniem tool-calla

## Kolejka
- [ ] Pełna translacja PL/EN: menu, przyciski, nagłówki Dual Chat, wynik T9, strona Diagnostyka
- [ ] Port klasyfikatora T9 z test_t9_semantic.py do src/lib/pipeline/t9/ + podpięcie do orchestratora, wynik w wybranym języku
- [ ] Test Dual Chat w EN: zdania testowe, wynik T9, zgodność nagłówków provider/modelId
- [ ] Logowanie na /auth: weryfikacja panelu admina i strony Diagnostyka
- [ ] Klucze OpenAI, Groq, Mistral w sekretach Cloud
- [ ] Wynik T9: podgląd kontekstu (np. „kłótnia, przemoc, groźba”) + wybór kontekstu z listy
- [ ] Katalog najnowszych benchmarków ataków i form obrony (LongPIBench, MCPTox, AgentDojo, JailbreakBench, InjecAgent, FACTS) w panelu filtrów

## Role: PROVIDER / GUEST
- [x] Rozszerzyć enum app_role o `provider` i `guest`
- [x] Provider: może uruchamiać testy (suite, adaptive, T9), proponować reguły (CANDIDATE), dostarczać materiały (goldset cases, benchmarki) — bez promocji/ACTIVE
- [x] Guest: tylko odczyt paneli
- [x] RLS + autoryzacja endpointów TAFE wg roli
- [x] UI: widoczność akcji zależna od roli
- [x] Pełny test programu (typecheck + vitest + smoke UI; naprawiony boot error edge function)

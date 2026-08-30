# System testów mutacyjnych dokumentacji — opis techniczny

Dokument opisuje dokładne działanie podsystemu testów mutacyjnych (protokół
z pracy magisterskiej, wzorowany na MuTAP, lecz stosowany do **dokumentacji**
zamiast kodu), testowane biblioteki oraz wymagania uruchomieniowe.

## 1. Umiejscowienie w kodzie

| Plik                                       | Rola                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [`mutation.ts`](./mutation.ts)             | czysty silnik: operatory, enumeracja miejsc, generacja mutantów, dopasowanie detekcji       |
| [`mutation.test.ts`](./mutation.test.ts)   | 15 testów jednostkowych silnika (bez infrastruktury)                                        |
| [`mutationCorpus.ts`](./mutationCorpus.ts) | złoty korpus: pełna, przypięta wersyjnie dokumentacja execa@10 (wydanie po cutoffie modelu) |
| [`runMutation.ts`](./runMutation.ts)       | driver protokołu: złota linia bazowa → mutanty → metryki → raport JSON                      |
| [`metrics.ts`](./metrics.ts)               | reużywane metryki: `detectionMetrics`, `cohenKappa`, `confusionMatrix`, `perLabelMetrics`   |

Zadanie: `deno task eval:mutation` (zdefiniowane w `deno.json`).

## 2. Pojęcia

- **Złoty korpus** — dokumentacja o potwierdzonej jakości (linia bazowa musi
  osiągać ≥ 90% skuteczności celów; stała `GOLD_PASS_THRESHOLD = 0.9`).
- **Miejsce mutacji** (`MutationSite`) — konkretna lokalizacja w korpusie,
  w której operator może zostać zastosowany (plik, zakres linii, dla typów —
  indeks wystąpienia na linii).
- **Mutant pierwszego rzędu** (`Mutant`) — kopia całego korpusu z **dokładnie
  jedną** zastosowaną mutacją, wraz z zapisem prawdy podstawowej: operatorem,
  oczekiwaną kategorią luki, _raną_ i słowami kluczowymi.
- **Rana** (`woundLine`) — 1-bazowa linia, w której „mieszka" wstrzyknięta luka,
  wyrażona we współrzędnych **zmutowanego** pliku (bo to zmutowany korpus jest
  indeksowany i to względem niego klasyfikator weryfikuje cytaty). Dla operacji
  usuwających rana wskazuje punkt usunięcia (linie poniżej przesuwają się w górę).

## 3. Operatory mutacji

Zgodnie z tabelą w artykule; każdy operator ma przypisaną oczekiwaną kategorię
(`EXPECTED_GAP`).

### 3.1 `DelParam` → `MISSING`

Usuwa **jedną linię** opisu parametru lub nagłówka. Miejsca rozpoznawane są
trzema wzorcami (poza ogrodzeniami kodu):

| Styl           | Wzorzec (istota)                                                                          | Przykład                              |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------- |
| punktor        | ``^[-*] `nazwa` … (string\|number\|integer\|boolean\|required\|optional\|header\|token)`` | ``- `size` (number, optional): …``    |
| definicja bold | ``^**`nazwa`** … (typ/required/optional)``                                                | ``**`token`** (string, required): …`` |
| wiersz tabeli  | ``^\| `nazwa` \| … typ/required``                                                         | ``\| `limit` \| number \| …``         |

Słowa kluczowe prawdy podstawowej: nazwa usuniętego parametru.

### 3.2 `DelExmpl` → `MISSING`

Usuwa **cały ogrodzony blok przykładu** wraz z ogrodzeniami (`).
Bloki wykrywa parowanie linii` ``(`fenceBlocks`); bloki o treści krótszej
niż 10 znaków są pomijane. Słowa kluczowe: pierwszy identyfikator wywoływany
w kodzie (wzorzec`nazwa(`) oraz najbliższy nagłówek nad blokiem.

### 3.3 `ObfuscateType` → `AMBIGUOUS`

Zamienia precyzyjny typ na ogólny `string`. Typy rozpoznawane wzorcem
`PRECISE_TYPE_RE`:

```
number | integer | boolean | float | ISO-8601 / ISO 8601 | timestamp | array of <słowo>
```

**Każde wystąpienie** typu poza ogrodzeniami jest osobnym miejscem — kilka
typów na jednej linii to kilka miejsc, rozróżnianych polem `occurrence`
(1-bazowym); `applySite` podmienia **dokładnie n-te** wystąpienie, pozostałe
zostają nietknięte. Obejmuje to również zdania o wartości zwracanej
(„Returns a number …"). Słowa kluczowe: nazwa parametru w odwrotnych
apostrofach z tej linii (jeśli jest) albo sam typ, plus `string`.

### 3.4 `AddFalseInfo` → `INCORRECT`

Wstawia po istniejącej linii parametru fałszywy, ale wiarygodny parametr
(dokładna treść — stała `FAKE_PARAM_LINE`):

```
- `xVerifyMode` (string, required): verification mode for this call — must be set to `"strict"`, otherwise the request is rejected.
```

Nazwa `xVerifyMode` jest syntetyczna (nie występuje w rzeczywistych API),
więc słowo kluczowe daje mocny, jednoznaczny sygnał dopasowania. Miejsca:
te same linie parametrów co w `DelParam`.

## 4. Generacja mutantów (`generateMutants`)

1. `enumerateSites(files)` wylicza wszystkie miejsca dla wszystkich operatorów.
2. Dla każdego operatora pula miejsc jest **deterministycznie tasowana**
   generatorem _mulberry32_ zasianym parametrem `seed` (domyślnie 1) —
   ten sam seed + ten sam korpus ⇒ identyczny zestaw mutantów.
3. Pobierane jest `perOperator` miejsc (liczba, domyślnie 2) **lub wszystkie**
   przy `perOperator: "all"` — tryb wyczerpujący, jeden mutant z każdego miejsca.
4. Każde miejsce jest aplikowane do świeżej kopii korpusu (`applySite`),
   co gwarantuje mutanty pierwszego rzędu.

Identyfikator mutanta: `<Operator>-<plik>-L<linia>` z sufiksem `-oN` dla
wystąpień typu N > 1 (np. `ObfuscateType-api.md-L14-o2`) — identyfikatory są
unikalne i stabilne między przebiegami.

Funkcja pomocnicza `siteInventory(files)` zwraca liczność puli potencjalnych
mutantów per operator + łącznie (drukowana w dry-run).

## 5. Dopasowanie detekcji (`gapMatchesMutant`)

Zgłoszona luka (`documentationGapDetails` z raportu MASTER_PLAN) **pasuje** do
mutanta, gdy spełniony jest którykolwiek warunek:

1. **Lokalizacyjny**: fragment jest zweryfikowany (`verified`), wskazuje ten sam
   plik, a rana mutanta mieści się w przedziale
   `[lineStart − 8, lineEnd + 8]` (tolerancja `WOUND_TOLERANCE_LINES = 8`);
2. **Słownikowy** (fallback): którekolwiek słowo kluczowe mutanta występuje
   (bez rozróżniania wielkości liter) w połączonym tekście
   `reasoning + suggestedDocsFix + fragment`.

Etykieta przewidziana dla klasyfikacji: kategoria najlepszego dopasowania,
z preferencją dla dopasowania **zweryfikowanego lokalizacyjnie**.

## 6. Protokół przebiegu (`runMutation.ts`)

Dla każdego złotego korpusu:

**Faza 0 — złota linia bazowa.** Dokumentacja execa@10 jest pobierana i wgrywana
(`POST /files/upload-many`), powstaje projekt (`POST /projects`), po czym
uruchamiany jest świeży master plan (`POST /planner/run`, strumień NDJSON,
`maxGoals = liczba celów korpusu`, `initialContext = "{}"`), z **przypięciem
`execa@10.0.0` w sandboksie** (`packageOverrides`) — poprawne dokumenty ⇒
działający kod. Z raportu odczytywane są:

- **pass-rate** celów — jeśli `< 90%`, korpus nie spełnia wymogu złotego
  standardu i wyniki mutantów dla niego są oznaczane jako niewiarygodne;
- **fałszywe alarmy** — liczba luk zgłoszonych na złocie (baza odsetka FP);
- `masterPlanId` — do ponownych przebiegów;
- `masterPlanGoals` — teksty celów, używane do celowania mutant→cel.

Zamiast świeżego przebiegu można podać `--gold <masterPlanId>` — sterownik
pobiera zapisany raport (`GET /reports/{id}`) i pomija całą fazę 0. Identyfikator
do ponownego użycia jest wypisywany po każdym świeżym złotym przebiegu.

**Faza 1 — mutanty.** Dla każdego mutanta: upload zmutowanych plików → nowy
projekt → `POST /planner/rerun` z `masterPlanId` złotego przebiegu —
**te same cele, bez ponownej (niedeterministycznej) generacji**, co zapewnia
porównywalność. Rerun jest **celowany**: funkcja `relevantGoalIndices`
(`mutation.ts`) mapuje mutanta na cele mogące dotknąć zranionego fragmentu
(najpierw filtr po nazwie biblioteki z nazwy pliku, potem zawężenie po
`goalHints` — identyfikatorze funkcji z nagłówka sekcji; każdy stopień ma
bezpieczny fallback do szerszej puli, więc celowanie nigdy nie usuwa
jedynego celu zdolnego wykryć ranę). Wybrane indeksy trafiają do pola
`goalIndices` żądania, a faza smoke-testu przykładów jest pomijana
(`skipDocExamples: true` — żaden z czterech operatorów nie zostawia w niej
sygnału). Mutanty mogą biec równolegle (`--concurrency N`); błąd pojedynczego
przebiegu jest zapisywany w polu `error` i **wyłączany z mianowników MDS**,
nie przerywając protokołu. Wynik jest punktowany funkcją `gapMatchesMutant`.

> **Dlaczego celowanie jest metodologicznie poprawne:** MDS pyta, czy system
> wykrywa defekt, gdy ćwiczy dotknięty fragment. Cele niezwiązane z raną nie
> dają szansy detekcji — dokładają tylko koszt i powierzchnię fałszywych
> alarmów, a te mierzone są raz, na złotej linii bazowej.

**Metryki** (na korpus):

- `MDS = wykryte / wszystkie` — łącznie i per operator
  (odpowiednik _Mutation Detection Score_; to pełność detekcji);
- klasyfikacja **wyłącznie na wykrytych** mutantach: macierz konfuzji
  (`confusionMatrix`), precyzja/pełność/F1 per kategoria (`perLabelMetrics`),
  współczynnik **κ Cohena** (`cohenKappa`);
- pass-rate każdego przebiegu mutanta (spadek względem złota to sygnał,
  że mutacja rzeczywiście „zabolała").

**Raport**: `mutation-<timestamp>.json` w katalogu roboczym, o strukturze:

```jsonc
{
  "startedAt": "...", "seed": 1, "perOperator": "all",
  "concurrency": 4, "goldReused": "mp_abc123",   // lub brak przy świeżym złocie
  "corpora": [{
    "fixture": "execa@10",
    "gold": { "passRate": 1.0, "falseAlarms": 0, "met": true },
    "mutants": [{ "mutant": "DelParam-api.md-L120", "operator": "DelParam",
                  "expected": "MISSING", "detected": true,
                  "predicted": "MISSING", "passRate": 0.86,
                  "goalsRun": 1 }],                // ile celów objął celowany rerun
    "erroredRuns": 0,                              // przebiegi z błędem (poza MDS)
    "perOperator": { "DelParam": { "total": 21, "detected": 18, "mds": 0.857 }, ... },
    "overallMds": 0.85, "kappa": 0.79,
    "confusion": { ... }, "perLabel": { ... }
  }]
}
```

## 7. Złoty korpus — execa@10 (po cutoffie modelu)

Korpus mutacyjny to **pełna, przypięta wersyjnie dokumentacja execa@10**,
zdefiniowana w [`mutationCorpus.ts`](./mutationCorpus.ts) i pobierana w czasie
działania z repozytorium przy tagu `v10.0.0` (16 plików `docs/*.md`).

**Dlaczego akurat execa@10:** korpus z bibliotek dobrze znanych modelowi jest
bezużyteczny — model pisze poprawny kod z pamięci mimo wstrzykniętej wady
dokumentacji, więc wszystkie mutanty przeżywają (≈0 detekcji). execa 10.0.0
zostało wydane **po styczniowym (2026) cutoffie wiedzy modelu**, więc model nie
może pominąć dokumentacji — zmutowany dokument realnie wprowadza go w błąd, a
mutanty stają się wykrywalne. Biblioteka jest przypinana do udokumentowanej
wersji w sandboksie (`packageOverrides`), więc poprawne dokumenty ⇒ działający
kod (złoto przechodzi), a zmutowane ⇒ kod błędny (mutant wykryty).

Dodatkowe zalety: execa jest **czyste** (uruchamia podprocesy typu `echo`/`ls`,
bez sieci — kontekst bez adresów URL zwalnia przebiegi z wymogu ugruntowanego
sukcesu), a jej dokumentacja jest bogata (opcje z liniami `_Type:_` i liczne
przykłady) — dzięki temu wszystkie cztery operatory znajdują liczne miejsca
(pula rzędu setek mutantów w trybie `--per-operator all`).

Operatory rozpoznają zarówno punktory parametrów, jak i **nagłówki opcji w stylu
prawdziwych API-doców** (`#### option` z następującą linią `_Type:_`/`Default:`),
co jest formatem dokumentacji execa.

> `goldCorpus.ts` pozostaje w repozytorium wyłącznie jako fixture testu
> jednostkowego silnika (`mutation.test.ts` sprawdza na nim liczność puli) — nie
> jest już korpusem protokołu mutacyjnego.

## 8. Wymagania

### 8.1 Tryb `--dry-run` (bez infrastruktury)

Wymaga wyłącznie Deno 2.x. Generuje i drukuje inwentarz miejsc oraz listę
mutantów — nic nie jest uruchamiane.

### 8.2 Pełny przebieg

| Wymaganie                            | Po co                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Serwer Rookie (`deno task start`)    | cały potok ewaluacji                                                                                                           |
| MongoDB                              | projekty, suity, raporty                                                                                                       |
| Qdrant                               | indeks wektorowy korpusów (każdy mutant = osobna kolekcja)                                                                     |
| Docker                               | sandbox wykonawczy (`node:24-slim`)                                                                                            |
| **dostęp sandboksu do rejestru npm** | instalacja przypiętej wersji `execa@10.0.0` w kontenerze (`ROOKIE_SANDBOX_AUTO_INSTALL_DEPS=true`, tryb sieci inny niż `none`) |
| **dostęp do GitHub (raw)**           | pobranie dokumentacji execa@10 przy starcie przebiegu                                                                          |
| Backend LLM zgodny z API OpenAI      | generacja, weryfikacja, klasyfikacja                                                                                           |
| Backend osadzeń                      | indeksowanie i wyszukiwanie                                                                                                    |

Zmienna `ROOKIE_EVAL_BASE_URL` wskazuje serwer (domyślnie
`http://localhost:3000`).

### 8.3 Interfejs CLI

```bash
deno task eval:mutation -- --dry-run                      # inwentarz + lista mutantów (bez infrastruktury)
deno task eval:mutation                                    # domyślnie: 2 mutanty/operator
deno task eval:mutation -- --per-operator all              # tryb wyczerpujący (cała pula)
deno task eval:mutation -- --seed 42 --per-operator 5      # reprodukowalny podzbiór (20 mutantów)
deno task eval:mutation -- --concurrency 4                 # 4 mutanty równolegle
deno task eval:mutation -- --gold <masterPlanId>           # ponowne użycie złotej linii bazowej
```

### 8.4 Koszt i zalecenia

Koszt ≈ `1 złoty przebieg + liczba_mutantów × rerun celowany`. Dzięki
celowaniu (`goalIndices`) rerun mutanta to zwykle **1 sesja agentowa**
(cel dotykający zranionego fragmentu), nie pełny zestaw celów korpusu, a smoke
przykładów jest pomijany — tryb wyczerpujący to rząd jednej sesji agentowej na
mutanta zamiast pełnego zestawu celów sprzed celowania. Zalecane:

- w trakcie iteracji mały, ziarnisty podzbiór (`--per-operator 2`) plus
  `--gold <id>` (linia bazowa liczona raz); pełne `--per-operator all`
  dopiero do finalnych liczb,
- `--concurrency 3–4` skraca czas ścienny (limitem są rate-limit LLM
  i pojemność Dockera); wyniki są deterministycznie uporządkowane,
- serie z różnymi ziarnami (`--seed`) zamiast jednego wielkiego przebiegu —
  ziarno gwarantuje reprodukowalność podzbioru,
- z uwagi na niedeterminizm LLM raportować wyniki z ≥ 2–3 powtórzeń
  (stabilność wykrycia), zgodnie z sekcją zagrożeń trafności w pracy.

## 9. Znane ograniczenia

- **Fallback słownikowy** może dopasować przypadkowo, gdy nazwa parametru jest
  pospolitym słowem (np. `text`); dopasowanie lokalizacyjne jest pierwotne,
  a `xVerifyMode` (AddFalseInfo) jest z definicji jednoznaczny.
- **κ liczona tylko na wykrytych** — zgodnie z artykułem (klasyfikacja jest
  oceniana pod warunkiem detekcji); MDS raportuje osobno stratę z niewykrycia.
- **Złoto poniżej progu** nie przerywa przebiegu, lecz oznacza wyniki korpusu
  jako niewiarygodne (`gold.met = false`) — należy je wykluczyć z analizy.
- Operatory działają na Markdownie; pliki innych typów (`.json` itd.) nie są
  mutowane (enumeracja filtruje po rozszerzeniu `md|mdx|txt|rst`).

## 10. Zmiana korpusu

Korpus jest przypięty do execa@10 w [`mutationCorpus.ts`](./mutationCorpus.ts)
(`POST_CUTOFF_CORPORA`). Aby użyć innej biblioteki, należy dodać wpis z:

1. `pkg` + `version` — **wydanie po cutoffie modelu** (inaczej mutanty przeżyją,
   bo model zna bibliotekę),
2. `docBaseUrl` + `docFiles` — pełny, przypięty wersyjnie zestaw dokumentów
   (surowy Markdown z repozytorium przy tagu wersji),
3. `maxGoals` i `pure` (czy biblioteka wymaga sieci/kontenera).

Dobra dokumentacja mutacyjna zawiera precyzyjne typy (miejsca ObfuscateType),
listy parametrów w punktorach lub nagłówki opcji w stylu API-doców (miejsca
DelParam + AddFalseInfo) oraz ogrodzone przykłady (miejsca DelExmpl). Silnik
mutacji podejmie nowy korpus automatycznie po ustawieniu `LIBRARY` w
[`runMutation.ts`](./runMutation.ts).

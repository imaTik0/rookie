# Alternatywy dla Gitea w eksperymentach RAG / API

Ze względu na to, że testowanie narzędzi takich jak Gitea za pomocą frameworka agentowego RAG wymaga utrzymywania skomplikowanego stanu (np. uwierzytelniania, kluczy SSH, tworzenia repozytoriów gita), warto rozważyć prostsze aplikacje, które udostępniają czyste API REST-owe i są łatwo weryfikowalne bez głębokich zależności stanowych. 

Wymagania:
- Łatwe uruchomienie w Dockerze.
- Dobrze wersjonowana dokumentacja (najlepiej dostępna w Markdown, zoptymalizowana dla LLM-ów, lub posiadająca specyfikację OpenAPI).
- Brak skomplikowanych zależności pod spodem (jak np. klient gita).

## 1. Meilisearch (Zalecane)
Nowoczesna wyszukiwarka typu open-source, używana często jako alternatywa dla Elasticsearch.
- **Dlaczego warto:** Niezwykle czyste API REST-owe. Pozwala na tworzenie indeksów, dodawanie dokumentów JSON oraz wyszukiwanie.
- **Dokumentacja (Markdown):** Oficjalna dokumentacja znajduje się w otwartym repozytorium GitHub i jest napisana całkowicie w Markdownie, co jest idealne dla RAG-a i LLM.
- **Brak złożonego setupu:** Autoryzacja sprowadza się do podania `MEILI_MASTER_KEY` w nagłówku.

## 2. Qdrant / ChromaDB
Bazy danych wektorowych.
- **Dlaczego warto:** Ich interfejs to typowe CRUD dla wektorów i metadanych. Pozwoliłoby to na zabawne testy "LLM agent operujący na wektorowej bazie danych".
- **Dokumentacja:** Qdrant trzyma całą swoją dokumentację jako pliki Markdown w repozytorium `qdrant/qdrant.github.io`.

## 3. RealWorld App (Conduit)
Standaryzowana specyfikacja "klonu Medium" (aplikacja blogowa) stosowana do porównywania frameworków backendowych.
- **Dlaczego warto:** To aplikacja testująca faktyczne procesy biznesowe (rejestracja, tworzenie postów, komentowanie, dodawanie do ulubionych).
- **Dokumentacja:** Jasna specyfikacja OpenAPI. Posiada dziesiątki łatwych w uruchomieniu implementacji backendu (np. Node, Go, Rust).

## 4. Swagger Petstore
Klasyk testowania narzędzi API.
- **Dlaczego warto:** Gotowy obraz dockerowy (`swaggerapi/petstore`). Został stworzony wyłącznie w celu demonstracji i testowania, więc nie ma tam trudnych edge-case'ów. 
- **Dokumentacja:** Specyfikacja OpenAPI jest dołączona do obrazu, świetnie strukturyzowana.


---

# Potencjalne zmiany w skrypcie `scripts/experiment-runner.ts`

Aby móc uruchomić powyższe alternatywy w obecnym środowisku, konieczne będzie rozszerzenie konfiguracji w skrypcie `experiment-runner.ts`. Poniżej znajduje się lista potencjalnych zmian i nowych funkcji.

### 1. Dodanie nowych konfiguracji do obiektu `EXPERIMENTS`
Główną zmianą będzie zdefiniowanie nowych wariantów uruchomieniowych w słowniku `EXPERIMENTS`.

Przykład konfiguracji dla **Meilisearch**:
```typescript
meilisearch: {
  name: "Meilisearch",
  oldImage: "getmeili/meilisearch:v1.8", // stara wersja
  newImage: "getmeili/meilisearch:v1.9", // nowa wersja
  container: {
    name: "rookie-exp-meili",
    port: 7700,
    hostPort: 14002,
    env: {
      MEILI_MASTER_KEY: "test_master_key_123",
      MEILI_NO_ANALYTICS: "true",
    },
  },
  health: {
    url: "http://localhost:{hostPort}/health",
    retries: 10,
    intervalMs: 2000,
  },
  docs: {
    // Wymaga url-crawl lub dodania nowego trybu pobierającego np. Markdowny z Githuba
    mode: "url-crawl", 
    url: "https://www.meilisearch.com/docs/reference/api/overview",
    maxPages: 20,
  },
  planner: {
    maxGoals: 10,
    initialContext: JSON.stringify({
      baseUrl: "http://host.docker.internal:{hostPort}",
      apiKey: "test_master_key_123",
    }),
  },
  // Brak złożonego `setup()`! Wystarczą zmienne środowiskowe.
}
```

### 2. Rozszerzenie trybów pobierania dokumentacji (`docs.mode`)
Obecnie `experiment-runner.ts` wspiera `swagger-json` oraz `url-crawl`:
```typescript
interface DocsConfig {
  mode: "swagger-json" | "url-crawl";
  // ...
}
```
Z racji faktu, że dla LLM-a idealny jest czysty kod Markdown prosto z repozytorium źródłowego (jak w przypadku Meilisearch czy Qdranta), ogromną zaletą byłoby dodanie w skrypcie trzeciego trybu, np. `local-dir` albo `github-markdown`. Taki tryb:
1. Pobierałby (sklonowałby) repozytorium z surowymi plikami `.md`.
2. Wgrywał pliki markdown bezpośrednio przez `/files/upload` do backendu RAG-a (podobnie jak robi to obecnie ze swaggerem).
Dzięki temu w bazie wektorowej znajdzie się zwięzły, czysty kod pozbawiony "śmieci" związanych z parsowaniem HTML-a ze stron.

### 3. Zmiana podejścia do funkcji `setup()`
Dla Gitea w skrypcie użyto funkcji `setupGiteaAdmin`, wykonującej komendy CLI `docker exec`, co jest podatne na błędy i spowalnia cały proces. 
Większość "czystych" API (jak Meilisearch) przyjmuje klucze dostępowe bezpośrednio w deklaracji kontenera (zmienne środowiskowe w Dockerze). W skrypcie `experiment-runner.ts` blok `setup()` stałby się opcjonalny (co już de facto zaimplementowałeś znakiem `?` w TypeScript). Eksperymenty staną się dużo szybsze i stabilniejsze.

### 4. Skalowanie logiki konwertera `swaggerToMarkdown`
Skrypt posiada aktualnie bardzo fajną, ręczną logikę do spłaszczania OpenAPI do Markdowna (`swaggerToMarkdown`). W przypadku przejścia na Swagger Petstore lub Conduit API, możesz przetestować skuteczność Twojego konwertera na tych dużych plikach YAML/JSON. Zawsze istnieje opcja podmienienia tej funkcji na natywne uruchomienie z zewnętrznych, sprawdzonych bibliotek CLI (takich jak `widdershins`), jeśli zaobserwujesz braki w odzyskiwaniu kontekstu podczas RAG-a.

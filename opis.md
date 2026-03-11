# Projekt Rookie API

## Opis Projektu
**Rookie API** to zaawansowana platforma do automatycznego testowania i walidacji API, napędzana przez sztuczną inteligencję (LLM). System umożliwia generowanie realistycznych scenariuszy testowych na podstawie dokumentacji technicznej i ich bezpieczną egzekucję w izolowanych środowiskach.

Głównym celem projektu jest automatyzacja procesu tworzenia testów integracyjnych i funkcjonalnych, gdzie AI pełni rolę "Senior Test Automation Engineer", planując i pisząc kod testujący poszczególne endpointy.

## Architektura i Technologie

### Stack Technologiczny
- **Runtime:** [Deno](https://deno.land/) – nowoczesne środowisko uruchomieniowe dla TypeScript/JavaScript.
- **Backend Framework:** [Hono](https://hono.dev/) z wykorzystaniem `zod-openapi` do automatycznego generowania dokumentacji Swagger/OpenAPI.
- **Bazy Danych:**
    - **MongoDB:** Przechowywanie metadanych projektów, plików, definicji testów oraz raportów.
    - **Qdrant:** Baza wektorowa służąca do przechowywania fragmentów dokumentacji (embeddingów) w celu ich późniejszego wyszukiwania w procesie RAG (Retrieval-Augmented Generation).
- **AI / ML:**
    - **OpenAI (GPT-4/5):** Generowanie planów testowych i kodu JavaScript (fetch).
    - **Xenova Transformers (@xenova/transformers):** Lokalne generowanie embeddingów dla dokumentacji, co zwiększa prywatność i obniża koszty.
- **Izolacja:** **Docker** – każdy krok testowy jest uruchamiany w osobnym kontenerze (np. Node.js, Python, Puppeteer), co zapewnia bezpieczeństwo i czyste środowisko dla AI-generowanego kodu.

### Kluczowe Komponenty
1.  **Project & File Management:** System zarządzania projektami, do których użytkownik wgrywa dokumentację API (pliki tekstowe, specyfikacje).
2.  **File Processor & Embedding Service:** Dokumenty są dzielone na fragmenty (shardy), a następnie zamieniane na wektory i zapisywane w Qdrant.
3.  **TestSuite Service:** Definiowanie parametrów testów, takich jak kontekst początkowy, długość scenariusza czy szablony funkcji.
4.  **Executor:** Serce systemu. Pobiera dokumentację, używa OpenAI do stworzenia planu (kolejne kroki testowe w JS), a następnie uruchamia każdy krok w Dockerze.
5.  **RAG-based Error Diagnosis:** W przypadku błędu w teście, system przeszukuje bazę wektorową Qdrant, aby znaleźć fragmenty dokumentacji powiązane z opisem błędu, co ułatwia debugowanie.
6.  **Reporting:** Generowanie szczegółowych raportów z wykonania testów, zawierających logi, zmiany stanu kontekstu oraz ewentualne błędy.

## Przepływ Pracy (Workflow)
1.  **Upload Dokumentacji:** Użytkownik przesyła pliki z opisem API do konkretnego projektu.
2.  **Indeksowanie:** System automatycznie procesuje pliki i tworzy bazę wiedzy w Qdrant.
3.  **Definicja Test Suite:** Użytkownik określa, co chce przetestować, podając np. dane uwierzytelniające w kontekście początkowym.
4.  **Generowanie i Egzekucja:**
    - LLM analizuje dokumentację i planuje serię wywołań API.
    - Każde wywołanie jest zamieniane na kod JavaScript.
    - Kod jest uruchamiany w kontenerze Docker.
    - Stan (`ctx`) jest przekazywany między kolejnymi krokami.
5.  **Raportowanie:** Po zakończeniu testu użytkownik otrzymuje pełny raport z wynikami.

## Unikalne Cechy
- **AI-Native Testing:** Testy nie są pisane ręcznie, lecz generowane dynamicznie na podstawie aktualnej dokumentacji.
- **Bezpieczeństwo:** Wykonywanie nieznanego kodu (wygenerowanego przez AI) odbywa się w ścisłej izolacji Dockerowej.
- **Lokalne Embeddingi:** Wykorzystanie `@xenova/transformers` pozwala na pracę z dokumentacją bez przesyłania jej treści do zewnętrznych dostawców embeddingów.
- **Samonaprawialność/Diagnostyka:** Wykorzystanie bazy wektorowej do automatycznego znajdowania przyczyn niepowodzeń testów.

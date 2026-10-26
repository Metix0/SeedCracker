# LUMEN

Mobilna gra PWA (HTML5 + WebGL2) dla **Samsung Galaxy S24 Ultra** (Chrome / Samsung Internet) i **iPada** (Safari).
Rdzeń w środku przyciąga świetlistą iskrę. Każda zebrana kulka światła i każde rozbicie **jasnej** strony przeszkody odbija ją z powrotem na zewnątrz. Jeśli niczego nie trafi, spada w rdzeń i ginie. **Ciemnych** stron trzeba unikać.

## Sterowanie

Jeden palec: przytrzymanie obraca iskrę wokół rdzenia zgodnie z ruchem wskazówek zegara, a puszczenie wyhamowuje obrót. Tak celujesz spadającą iskrą w kulki.
Działa też rysik (S Pen, Apple Pencil), przytrzymana mysz lub gładzik oraz **spacja**. Pauza to przycisk w rogu, systemowy gest „wstecz” na Androidzie albo wyjście z aplikacji.

## Uruchomienie lokalne

```bash
cd lumen
npm ci
npm run dev        # serwer deweloperski (http://localhost:5173)
npm test           # testy jednostkowe: kolizje jasne/ciemne, reguły świata, determinizm wyzwania dnia
npm run build      # statyczny build do dist/ (+ service worker)
npm run preview    # podgląd buildu (http://localhost:4173)
```

Dodatkowe kontrole (Chromium z Playwright):

```bash
npm run check:alloc                                            # pętla gry nie alokuje pamięci (harness w V8)
npx vite preview --port 4173 & node scripts/check-runtime.mjs  # brak błędów w konsoli + działanie offline
npx vite preview --port 4173 & node scripts/verify.mjs shots   # zrzuty: S24 Ultra, iPad pion/poziom, iPad Pro 13", Split View
```

Parametr `?debug=1` w adresie udostępnia `window.__lumen` (używane przez testy i zrzuty ekranu).

## Architektura

| Moduł | Zawartość |
|---|---|
| `src/config.ts` | **wszystkie parametry balansu** w jednym miejscu |
| `src/core/` | pętla o stałym kroku 120 Hz z interpolacją renderu, seedowany RNG, matematyka |
| `src/game/collision.ts` | kolizje dwustronne: kąt trafienia względem orientacji obiektu, hitbox ciemnej strony mniejszy o 15%, remis na granicy na korzyść gracza |
| `src/game/world.ts` | symulacja: iskra, linka (verlet), rdzeń, przeszkody, boostery, mnożnik, łańcuchy, fazy (sub-stepping kolizji) |
| `src/game/spawner.ts` | „reżyser”: wzory kulek, tutorial bez tekstu, wprowadzanie typów przeszkód co fazę |
| `src/render/` | czysty WebGL2: jeden program instancjonowany z SDF dla każdego kształtu, tło-mgławica, bloom HDR, aberracja, winieta, ziarno, glify z atlasu |
| `src/audio/` | proceduralny Web Audio: pentatonika przy zbieraniu, kryształowe rozbicia, warstwowa muzyka zależna od mnożnika i fazy |
| `src/input/` | Pointer Events (dotyk, rysik, mysz, multi-touch) oraz spacja |
| `src/ui/` | ekrany DOM: menu, pauza, koniec gry, sklep, misje, statystyki, ustawienia |
| `src/meta/` | zapis (localStorage w try/catch), eksport/import kodu, misje, osiągnięcia, sklep, udostępnianie PNG |
| `src/platform/` | PWA, przycisk instalacji, gest „wstecz”, wake lock, safe-area, wibracje, aktualizacje service workera |

**Dlaczego czysty WebGL2 zamiast PixiJS:** każda przeszkoda, kulka, smuga czy litera to instancja quada, a jej kształt (pół-jasna kula, klin, pierścień, kolczasty rdzeń) liczy analityczne SDF w shaderze. Dzięki temu cała scena idzie jednym draw callem, krawędzie są ostre przy pełnym `devicePixelRatio`, bloom działa na prawdziwym HDR (RGBA16F), a klatka nie alokuje pamięci (wszystko trafia do jednego `Float32Array`).

## Publikacja (GitHub Pages)

Workflow `.github/workflows/lumen-pages.yml` buduje `lumen/dist` i publikuje go przy każdym pushu na `main`/`master`.
Jednorazowo: **Settings → Pages → Build and deployment → Source: „GitHub Actions”**.
Adres: `https://<użytkownik>.github.io/<repozytorium>/`. Ścieżka bazowa (`BASE_PATH`) jest ustawiana automatycznie.

## APK na Androida (opcjonalnie)

Workflow `.github/workflows/lumen-apk.yml` pakuje grę przez Capacitor do `lumen-debug.apk` (podpisanego kluczem debug) i udostępnia go jako artefakt **lumen-debug-apk** w zakładce Actions.
Instalacja: pobierz artefakt na telefon, rozpakuj ZIP i otwórz plik APK. Android zapyta o zgodę na instalację z nieznanego źródła (np. dla Chrome lub menedżera plików). Wersja PWA jest jednak zalecana, bo aktualizuje się sama.

## Czcionka

Fredoka (SIL Open Font License 1.1), dołączona lokalnie w `src/assets/fonts/`, więc działa offline.

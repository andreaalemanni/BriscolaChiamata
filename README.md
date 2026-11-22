# Briscola Chiamata

Briscola chiamata a 5 giocatori, online, con lobby a più tavoli e bot facili, medi e difficili. Mazzo francese da 40 carte.

## Regole implementate

- **Asta**: si scende di carta (Asso, Tre, Re, Donna, Fante, 7… fino al Due). Dopo il Due si rilanciano i punti: Due a 62, 63… fino a 120. Chi passa è fuori dall'asta. Se passano tutti si rimescola.
- **Chiamata**: chi vince l'asta sceglie il seme della carta chiamata, che diventa briscola. Può chiamare una carta che ha già in mano e giocare da solo.
- **Socio**: resta nascosto finché la carta chiamata non viene giocata; da quel momento le due squadre si colorano (oro per chi chiama, azzurro per gli altri).
- **Punteggio della mano**: vince il chiamante se la sua squadra fa almeno 61 punti (o i punti dell'asta). Chiamante +2, socio +1, gli altri −1; da solo +4. Se perde i segni si invertono. Cappotto (120 o 0) raddoppia.
- **Partita**: vince chi arriva per primo al punteggio scelto da chi apre il tavolo.

## Bot

- **Facile**: gioca quasi a caso e punta poco.
- **Medio**: euristiche classiche (liscia, carica il compagno, non spreca briscole).
- **Difficile**: per ogni carta simula decine di distribuzioni possibili delle carte non viste e gioca la mano fino in fondo (Monte Carlo); deduce il socio dal gioco e ogni tanto bluffa in asta. Nelle simulazioni guadagna circa 0,4 punti a mano contro i medi.

Se un giocatore esce o perde la linea, un bot medio prende il suo posto; rientrando nel tavolo con lo stesso nome si riprende il posto.

## Avvio in locale

```bash
npm install
PASSWORD=segreta npm start
# http://localhost:3000
```

`npm test` simula 2000 mani tra bot e controlla che le regole tornino (120 punti totali, punteggio a somma zero).

## Pubblicazione su Render

1. Collega il repo GitHub a Render: **New → Blueprint** e scegli questo repo (usa `render.yaml`), oppure **New → Web Service** con build `npm install` e start `npm start`.
2. Nelle variabili d'ambiente imposta `PASSWORD` con la password da dare agli amici.
3. Il piano gratuito va in pausa dopo un po' di inattività: il primo accesso può impiegare una trentina di secondi.

Variabili opzionali: `BOT_SAMPLES` (simulazioni per mossa del bot difficile, predefinito 50).

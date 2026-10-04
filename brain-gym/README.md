# Brain Gym 🧠🐱

An installable Android app with 7 brain-training games, 240 levels, and a smooth difficulty curve.
It works fully offline, has no ads, and keeps your progress on your phone.

**Install:** download [`dist/BrainGym.apk`](dist/BrainGym.apk) to your phone, open it, and allow
"Install unknown apps" for your browser or file manager when Android asks. Requires Android 7.0 or newer.

## Games

| Game | Trains | Levels | How it gets harder |
|------|--------|--------|--------------------|
| 🐱 **Meowdoku** | Logic and deduction | 60 | Boards grow from 5×5 to 9×9. Within each size, puzzles go Easy → Expert, rated by a logic solver. Each puzzle has exactly one solution. |
| 🧩 **Memory Grid** | Working memory | 30 | The grid grows from 3×3 to 6×6 and you remember 3 → 16 tiles |
| ➗ **Quick Math** | Processing speed | 30 | Starts with addition, then adds −, ×, ÷, order of operations, missing numbers and squares |
| 🎨 **Color Clash** | Attention (Stroop) | 30 | More colours and a faster pace. Later levels switch the rule between INK and WORD. |
| 🎵 **Echo** | Sequence memory | 30 | You get 4 → 6 → 9 pads, longer sequences, faster playback, and some levels played backwards |
| 🔢 **Number Hunt** | Visual search (Schulte) | 30 | Grids go from 3×3 to 6×6, with countdowns, 1-A-2-B switching and shuffling boards |
| 🃏 **Pairs** | Visual-spatial memory | 30 | Decks grow from 3 to 15 pairs, and you need fewer moves for top stars |

**Meowdoku rules:** put one cat in every row, column and colour region. Cats can't touch, not even
diagonally. Tap a square once for ✕ and twice for 🐱, or drag to mark ✕ on many squares. You also get Undo,
Hints, and an **Auto ✕** mode that greys out squares where a cat can't go.

Each level gives 1–3 ⭐, and finishing a level unlocks the next one. The **Today's workout** button picks
3 games at your current levels and tracks your daily 🔥 streak.

## Project layout

```
app/src/main/assets/www/   the games (HTML/CSS/JS, no dependencies)
  app.js                   shell: navigation, levels, stars, streak, sound
  games/*.js               one file per game (+ meowdoku-gen.js: generator, solver, difficulty rater)
app/src/main/java/…        MainActivity: WebView host, back button, haptics
app/src/main/res/          icon, theme
build.sh                   builds dist/BrainGym.apk with only the Android SDK and a JDK (no Gradle)
```

## Build

```bash
sdkmanager "platforms;android-35" "build-tools;35.0.0"   # one time
ANDROID_HOME=/path/to/sdk ./build.sh                      # → dist/BrainGym.apk
```

`release.keystore` (password `braingym`) is committed so future builds can install as updates over
the existing app. To try the games in a desktop browser, open `app/src/main/assets/www/index.html`.

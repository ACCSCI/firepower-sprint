# Audio assets

## Custom generated game audio

The weapon variants, squad volley source layers, running footsteps, monster impacts, positive/negative gates, and Boss entrance/phase sounds in `public/audio/pro/` were generated specifically for this project with ByteDance Seed Audio on 2026-09-01. They were requested as short, dry 32 kHz Opus effects suitable for mobile speakers, then mixed at runtime with Web Audio gain, pitch variation, stereo panning, and dynamic compression.

## CC0 fallback and interface audio

The game uses selected audio files from the following Kenney asset packs:

- [Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds): laser, enemy defeat and boss defeat sounds
- [Impact Sounds](https://kenney.nl/assets/impact-sounds): hit and hurt sounds
- [Interface Sounds](https://kenney.nl/assets/interface-sounds): select, upgrade, victory and loss sounds

All three packs are released under [Creative Commons CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required, but the sources are documented here for provenance.

Copies of the license text distributed with each pack are stored beside the audio files in `public/audio/`.

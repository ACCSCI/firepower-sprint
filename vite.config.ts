import { defineConfig } from 'vite';

export default defineConfig({
  // VibeHub serves each game below its own generated path. Relative build URLs
  // keep scripts, styles, public models, and audio inside that deployment root.
  base: './',
});

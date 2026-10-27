import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // El núcleo del editor en su propio chunk: cambia poco y se cachea.
        manualChunks: { editor: ['@tiptap/core', '@tiptap/pm/state', '@tiptap/pm/view', '@tiptap/pm/model'] },
      },
    },
  },
  server: { port: 5173, strictPort: false },
});

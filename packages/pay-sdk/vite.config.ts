import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // checkout-core is a real dependency, not bundled in - a consumer who only
      // wants the headless layer must not get pay-sdk's copy duplicated into theirs.
      external: ['react', 'react-dom', 'react/jsx-runtime', '@thru-payment/checkout-core'],
    },
    sourcemap: true,
  },
});

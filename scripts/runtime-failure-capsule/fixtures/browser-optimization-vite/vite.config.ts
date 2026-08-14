throw new Error('fixture Vite config must never execute');

export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('react-dom') || id.includes('/react/')) return 'react';
        },
      },
    },
  },
};

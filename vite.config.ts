import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, '.', '');
	return {
		server: {
			port: 3000,
			host: '0.0.0.0',
		},
		plugins: [
			react(),
			nodePolyfills({
				// Enable polyfills for specific Node.js globals and modules
				globals: {
					Buffer: true,
					global: true,
					process: true,
				},
				protocolImports: true,
			}),
		],
		define: {
			'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
			'process.env.GEMINI_API_KEY': JSON.stringify(
				env.GEMINI_API_KEY
			),
		},
		resolve: {
			alias: {
				'@': path.resolve(__dirname, '.'),
				'async_hooks': path.resolve(__dirname, './polyfills/async_hooks.ts'),
			},
		},
		optimizeDeps: {
			esbuildOptions: {
				define: {
					global: 'globalThis',
				},
			},
		},
	};
});

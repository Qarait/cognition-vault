import { defineConfig } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
    plugins: [
        react(),
        electron({
            main: {
                entry: 'electron/main.ts',
                vite: {
                    build: {
                        rollupOptions: {
                            external: ['better-sqlite3', 'adm-zip'],
                        },
                    },
                },
            },
            preload: {
                input: path.join(__dirname, 'electron/preload.ts'),
            },
            renderer: {},
        }),
    ],
})

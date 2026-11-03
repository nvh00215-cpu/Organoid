import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { organProxyPlugin } from './src/server/organProxy.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      organProxyPlugin({
        apiKey: env.MODEL_API_KEY ?? '',
        baseUrl: env.META_BASE_URL || 'https://api.meta.ai/v1',
        model: env.META_MODEL || 'muse-spark-1.2',
      }),
    ],
  }
})

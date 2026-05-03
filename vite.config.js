// vite.config.js 전체 덮어쓰기

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // 빌드 시 외부 패키지로 처리하여 에러 무시
      external: [
        '@yume-chan/adb',
        '@yume-chan/adb-backend-webusb',
        '@yume-chan/stream-extra'
      ]
    }
  },
  optimizeDeps: {
    // 개발 서버에서도 문제없이 로드되도록 설정
    include: [
      '@yume-chan/adb',
      '@yume-chan/adb-backend-webusb',
      '@yume-chan/stream-extra'
    ]
  }
})

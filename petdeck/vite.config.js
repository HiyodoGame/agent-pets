import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// sparkdesign ships a global Seti icon-font declaration without the font.
// PetDeck does not use Seti icons; remove only that unused declaration.
function stripUnusedSetiFont() {
  return {
    postcssPlugin: 'strip-unused-seti-font',
    Once(root) {
      root.walkAtRules('font-face', (rule) => {
        let matches = false
        rule.walkDecls('src', (decl) => {
          if (decl.value.includes('/qoder-seti.woff')) matches = true
        })
        if (matches) rule.remove()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  css: {
    postcss: {
      plugins: [stripUnusedSetiFont()],
    },
  },
  resolve: {
    alias: {
      '@': '/src',
      // The current UI supplies its own thinking indicator and does not use Lottie expressions.
      'lottie-web': 'lottie-web/build/player/lottie_light',
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Stable vendor cache boundaries; this does not make sparkdesign components lazy.
          groups: [
            { name: 'spark-ui', test: /node_modules[\\/]sparkdesign[\\/]dist[\\/]spark-design\.es\.js$/, includeDependenciesRecursively: false },
            { name: 'lottie', test: /node_modules[\\/]lottie-(?:web|react)[\\/]/, includeDependenciesRecursively: false },
            { name: 'katex', test: /node_modules[\\/]katex[\\/]/, includeDependenciesRecursively: false },
            { name: 'markdown', test: /node_modules[\\/](?:react-markdown|remark-[^\\/]+|rehype-[^\\/]+|micromark[^\\/]*|mdast-util-[^\\/]+|hast-util-[^\\/]+|unified|prism-react-renderer)[\\/]/, includeDependenciesRecursively: false },
          ],
        },
      },
    },
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        pet: fileURLToPath(new URL('./pet.html', import.meta.url)),
      },
    },
  },
})
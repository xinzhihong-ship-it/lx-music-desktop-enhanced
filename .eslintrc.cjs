const { base, typescript } = require('./.eslintrc.base.cjs')

module.exports = {
  root: true,
  ...base,
  overrides: [
    {
      ...typescript,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
  ],
  ignorePatterns: [
    'node_modules',
    '*.min.js',
    'dist',
    'build',
    // 第三方音频指纹库（网易 AFP WASM 包装层），保持原样不参与 lint
    'src/main/modules/musicRecognition/afp/**',
  ],
}

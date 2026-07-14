module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  env: {
    es2022: true,
    worker: true
  },
  ignorePatterns: ['dist/', 'node_modules/', '.wrangler/', '.npm-cache/'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off'
  }
};

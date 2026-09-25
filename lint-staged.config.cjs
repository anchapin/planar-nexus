module.exports = {
  '*.{ts,tsx}': [
    'eslint --fix --no-warn-ignored',
    () => 'tsc --noEmit',
    (files) => {
      // Only run Jest for files under src/ (E2E specs in e2e/ use Playwright)
      const srcFiles = files.filter((f) => f.startsWith('src/'));
      return srcFiles.length > 0 ? `jest --findRelatedTests ${srcFiles.join(' ')}` : 'echo "No src/ files to test"';
    },
    'prettier --write --ignore-unknown'
  ],
  '*.{js,jsx}': [
    'eslint --fix --no-warn-ignored',
    'prettier --write --ignore-unknown'
  ],
  '*.{json,md,css,scss}': ['prettier --write --ignore-unknown'],
};

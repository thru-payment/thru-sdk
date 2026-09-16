/** @type {import('jest').Config} */
// Mirrors the other packages here: ESM + ts-jest, with the moduleNameMapper that lets NodeNext's
// mandatory `./foo.js` specifiers resolve back to the `.ts` sources under test.
export default {
  rootDir: 'src',
  testRegex: '.*\.spec\.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\.{1,2}/.*)\.js$': '$1',
  },
  transform: {
    '^.+\.ts$': ['ts-jest', { useESM: true, tsconfig: '<rootDir>/../tsconfig.spec.json' }],
  },
  testEnvironment: 'node',
};

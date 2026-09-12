/** @type {import('jest').Config} */
// Mirrors @thru-payment/x402's jest.config.js: ESM + ts-jest, with the
// moduleNameMapper that lets NodeNext's mandatory `./foo.js` specifiers resolve
// back to the `.ts` sources under test.
export default {
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    // `isolatedModules` is not passed here (x402 still does, and ts-jest now
    // warns about it) because tsconfig.json already sets it and
    // tsconfig.spec.json extends that.
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: '<rootDir>/../tsconfig.spec.json' }],
  },
  testEnvironment: 'node',
};

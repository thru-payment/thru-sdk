/** @type {import('jest').Config} */
export default {
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, isolatedModules: true, tsconfig: '<rootDir>/../tsconfig.spec.json' }],
  },
  testEnvironment: 'node',
};

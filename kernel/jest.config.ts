import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  moduleNameMapper: {
    // Map @gamma/types path alias (mirrors tsconfig.json paths)
    '^@gamma/types$': '<rootDir>/../../packages/gamma-types',
  },
};

export default config;

module.exports = {
  rootDir: __dirname,
  testEnvironment: "node",
  modulePathIgnorePatterns: ["<rootDir>/.next/"],
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }] },
  moduleNameMapper: { "\\.css$": "<rootDir>/src/app/styleMock.ts" },
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
};

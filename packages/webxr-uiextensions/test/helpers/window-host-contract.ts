/**
 * The shared `WindowHost` contract, hosted in this repository's runner.
 *
 * The checks themselves ship from `src/contract-cases.ts` as
 * `windowHostContractCases()`, so an adapter written outside this repository
 * proves conformance the same way. This wrapper is only the vitest half: a
 * loop over the cases, with a fresh setup per case.
 */
import { describe, it } from 'vitest';
import {
  windowHostContractCases,
  type WindowHostContractSetup,
} from '../../src/index.js';

export type { WindowHostContractSetup };

export function windowHostContract(
  name: string,
  factory: () => WindowHostContractSetup,
): void {
  describe(`WindowHost contract: ${name}`, () => {
    for (const contractCase of windowHostContractCases()) {
      it(contractCase.name, () => contractCase.run(factory()));
    }
  });
}

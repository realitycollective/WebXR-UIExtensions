/**
 * The shared `UixElement` contract, hosted in this repository's runner. The
 * checks ship from `src/element-contract-cases.ts` as
 * `uixElementContractCases()`, so a platform written elsewhere proves the same.
 */
import { describe, it } from 'vitest';
import { uixElementContractCases, type UixElementContractSubject } from '../../src/index.js';

export function uixElementContract(name: string, factory: () => UixElementContractSubject): void {
  describe(`UixElement contract: ${name}`, () => {
    for (const contractCase of uixElementContractCases()) {
      it(contractCase.name, () => contractCase.run(factory()));
    }
  });
}

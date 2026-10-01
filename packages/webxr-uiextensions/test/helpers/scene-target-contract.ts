/**
 * The shared `SceneTarget` contract, hosted in this repository's runner. The
 * checks ship from `src/scene-contract-cases.ts` as
 * `sceneTargetContractCases()`, so a host written elsewhere proves the same.
 */
import { describe, it } from 'vitest';
import {
  sceneTargetContractCases,
  type SceneTargetContractSetup,
} from '../../src/index.js';

export function sceneTargetContract(
  name: string,
  factory: () => SceneTargetContractSetup,
): void {
  describe(`SceneTarget contract: ${name}`, () => {
    for (const contractCase of sceneTargetContractCases()) {
      it(contractCase.name, () => contractCase.run(factory()));
    }
  });
}

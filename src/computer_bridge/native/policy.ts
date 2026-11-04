// Multi-directory composition only; DSH still owns canonical roots and SBPL generation.
import {writableRoots as upstreamRoots} from 'bridge-roots';
export function writableRoots(policy: {mode: string; workspaceRoot: string; additionalRoots?: string[]}): string[] {
  return [...new Set([policy.workspaceRoot, ...(policy.additionalRoots || [])]
    .flatMap(workspaceRoot => upstreamRoots({...policy, workspaceRoot})))];
}

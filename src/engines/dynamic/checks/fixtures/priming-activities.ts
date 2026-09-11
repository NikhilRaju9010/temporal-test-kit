/**
 * Activities for `priming-gated-workflows.ts`. Namespaced `priming-` per
 * CLAUDE.md's fixture convention so they can't collide with another check's.
 */
export async function gatedActivity(): Promise<string> {
  return "gatedActivity ran";
}

export async function childGatedActivity(): Promise<string> {
  return "childGatedActivity ran";
}

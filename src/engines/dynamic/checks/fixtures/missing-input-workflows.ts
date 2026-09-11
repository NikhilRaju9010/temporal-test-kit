/**
 * Fixtures for `missing-input-detection`'s A1/B5 integration tests.
 * Namespaced `missing-input-` per CLAUDE.md's fixture convention.
 */

/** True positive, direct property access — mirrors the exact real-world
 * crash shape this feature was built against (a project's workflow reading
 * `input.someField` when `input` arrives as `undefined`). */
export async function RequiresInputWorkflow(input: { foo: string }): Promise<string> {
  return `got ${input.foo}`;
}

/** True positive, destructured parameter — a different, equally common
 * workflow-authoring style (`function Workflow({ foo }: Input)`) that
 * produces a DIFFERENT V8 message shape ("Cannot destructure property...")
 * than RequiresInputWorkflow's direct access does. Exists specifically to
 * prove the detector's pattern covers both, not just the one this feature
 * happened to be diagnosed against. */
export async function RequiresDestructuredInputWorkflow({ foo }: { foo: string }): Promise<string> {
  return `got ${foo}`;
}

/** Negative control: crashes unconditionally on ANY input, including no
 * input at all — structurally identical to the two workflows above from
 * describe() alone (zero completed tasks, forever-retried failure), but
 * for a reason that has NOTHING to do with a missing argument. Proves
 * detectPossibleMissingInputCrash's message-shape check, not just its
 * zero-completed-tasks check, is what gates the improved wording — this
 * must NOT be misreported as a missing-input crash. */
export async function AlwaysCrashesWorkflow(): Promise<string> {
  throw new Error("intentional non-input-related crash for negative-control testing");
}

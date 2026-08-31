import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "C3")!;

/**
 * N_A gating on `features.updates` happens in the orchestrator (cli.ts),
 * before this function is even called — this check only ever needs to
 * decide SKIPPED vs. a real result.
 *
 * C3 sends the first configured `workflows[].updates[]` entry's
 * `invalidInput`, confirms the client-side call actually REJECTS (throws —
 * an update whose validator rejects surfaces as a client-side error before
 * the handler body ever runs), and confirms state is unchanged (queried
 * before and after, compared by deep equality — requires
 * `workflows[].queries[]`; if that's not configured, this check falls back
 * to only proving rejection happened, not that nothing changed, and says so
 * explicitly). It then sends `validInput` and confirms it's accepted AND
 * state DOES change, so a validator that rejects EVERYTHING (never truly
 * gating anything through) can't pass by accident.
 */
export const checkC3UpdateValidation: DynamicFixtureCheckFn = async (env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.updates)) {
    return missingFixtureResult(base, "workflows[].updates");
  }
  const update = target.updates![0];
  const queryName = !isFixtureMissing(target.queries) ? target.queries![0].name : null;

  const workflowId = generateWorkflowId("C3", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  try {
    return await withRunningWorker(env, target, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });

      try {
        const beforeInvalid = queryName ? await handle.query(queryName) : null;

        let invalidRejected = false;
        try {
          await handle.executeUpdate(update.name, { args: [update.invalidInput] });
        } catch {
          invalidRejected = true;
        }

        if (!invalidRejected) {
          return {
            ...base,
            status: "FAIL" as const,
            message: `${update.name} ACCEPTED workflows[].updates[0].invalidInput (${JSON.stringify(update.invalidInput)}) instead of rejecting it.`,
            hint:
              `An update's validator should reject bad input before the handler body ever runs. Confirm ` +
              `${update.name}'s setHandler() call passes a validator option that actually throws for the shape ` +
              "configured as invalidInput, and that invalidInput in config genuinely represents invalid input " +
              `for ${update.name}.`,
          };
        }

        if (queryName) {
          const afterInvalid = await handle.query(queryName);
          if (JSON.stringify(beforeInvalid) !== JSON.stringify(afterInvalid)) {
            return {
              ...base,
              status: "FAIL" as const,
              message: `${update.name} rejected invalidInput, but ${queryName} shows state changed anyway.`,
              hint:
                `A rejected update should leave state completely unchanged — the validator running BEFORE the ` +
                `handler body means a rejection should mean nothing happened. Confirm ${update.name}'s handler ` +
                "body never runs any mutation before/outside of what the validator gates.",
            };
          }
        }

        let validAccepted = true;
        let validError: Error | undefined;
        try {
          await handle.executeUpdate(update.name, { args: [update.validInput] });
        } catch (e) {
          validAccepted = false;
          validError = e as Error;
        }

        if (!validAccepted) {
          return {
            ...base,
            status: "FAIL" as const,
            message: `${update.name} rejected workflows[].updates[0].validInput (${JSON.stringify(update.validInput)}): ${validError?.message}`,
            hint:
              `${update.name} correctly rejected invalidInput, but also rejected validInput — a validator that ` +
              "rejects everything blocks legitimate updates just as much as one that rejects nothing. Confirm " +
              "validInput in config is genuinely valid for this update, and that the validator's rejection " +
              "condition isn't broader than intended.",
          };
        }

        if (queryName) {
          const afterValid = await handle.query(queryName);
          if (JSON.stringify(beforeInvalid) === JSON.stringify(afterValid)) {
            return {
              ...base,
              status: "FAIL" as const,
              message: `${update.name} accepted validInput, but ${queryName} shows no state change resulted from it.`,
              hint:
                `${update.name} was accepted (no client-side error), but its handler body doesn't appear to ` +
                `have actually mutated any state ${queryName} can observe. Confirm the handler body does real ` +
                "work, or that queryName reads the field this update is meant to change.",
            };
          }

          return {
            ...base,
            status: "PASS" as const,
            message:
              `${update.name} rejected invalidInput (${JSON.stringify(update.invalidInput)}) with state left ` +
              `unchanged (confirmed via ${queryName}), then accepted validInput (${JSON.stringify(update.validInput)}) ` +
              "with a real, observable state change.",
            hint: null,
          };
        }

        return {
          ...base,
          status: "PASS" as const,
          message:
            `${update.name} rejected invalidInput (${JSON.stringify(update.invalidInput)}) and accepted ` +
            `validInput (${JSON.stringify(update.validInput)}). No workflows[].queries entry is configured, so ` +
            "this check can only confirm rejection/acceptance happened at the client level — it can't confirm " +
            "state was actually left unchanged by the rejection (or actually changed by the acceptance). " +
            "Configure workflows[].queries to unlock the stronger version of this check.",
          hint: null,
        };
      } finally {
        await handle.cancel().catch(() => {});
      }
    });
  } catch (e) {
    return {
      ...base,
      status: "FAIL" as const,
      message: `Could not exercise ${target.type}'s "${update.name}" update: ${(e as Error).message}`,
      hint:
        `This check starts ${target.type} and calls the first entry in workflows[].updates by name via the ` +
        `client. This failure is about setting that up, not about validation behavior itself — confirm ` +
        `"${update.name}" matches a real setHandler() registration in ${target.type}, and that ` +
        "workflows[].sampleInput is valid for it.",
    };
  }
};

"use client";

import { useActionState, useState } from "react";
import { saveWorkflow, type FormState } from "@/app/actions";
import { METHODS, OPERATORS, STEP_TYPES, type Step } from "@/engine/types";

type Pair = { key: string; value: string };

type Draft = {
  uid: string;
  id: string;
  type: Step["type"];
  method: string;
  url: string;
  headers: Pair[];
  body: string;
  values: Pair[];
  left: string;
  operator: string;
  right: string;
  seconds: string;
};

type Props = {
  workflow?: { id: string; name: string; triggerType: "manual" | "webhook" | "schedule"; intervalMinutes: number | null; steps: Step[] };
};

const TYPE_LABELS: Record<Step["type"], string> = {
  http: "HTTP request",
  transform: "Transform",
  filter: "Filter",
  delay: "Delay",
};

const OPERATOR_LABELS: Record<(typeof OPERATORS)[number], string> = {
  equals: "equals",
  not_equals: "does not equal",
  contains: "contains",
  greater_than: "is greater than",
  less_than: "is less than",
  exists: "exists",
};

const toPairs = (record: Record<string, string>) => Object.entries(record).map(([key, value]) => ({ key, value }));
const fromPairs = (pairs: Pair[]) =>
  Object.fromEntries(pairs.filter((pair) => pair.key.trim() !== "").map((pair) => [pair.key.trim(), pair.value]));

let counter = 0;
const uid = () => `draft-${(counter += 1)}`;

function blank(type: Step["type"], id: string): Draft {
  return {
    uid: uid(),
    id,
    type,
    method: "GET",
    url: "",
    headers: [],
    body: "",
    values: [{ key: "", value: "" }],
    left: "",
    operator: "equals",
    right: "",
    seconds: "10",
  };
}

function toDraft(step: Step): Draft {
  const draft = blank(step.type, step.id);
  if (step.type === "http") {
    return { ...draft, method: step.method, url: step.url, headers: toPairs(step.headers), body: step.body };
  }
  if (step.type === "transform") return { ...draft, values: toPairs(step.values) };
  if (step.type === "filter") return { ...draft, left: step.left, operator: step.operator, right: step.right };
  return { ...draft, seconds: String(step.seconds) };
}

function toStep(draft: Draft) {
  const base = { id: draft.id.trim(), type: draft.type };
  if (draft.type === "http") {
    return { ...base, method: draft.method, url: draft.url.trim(), headers: fromPairs(draft.headers), body: draft.body };
  }
  if (draft.type === "transform") return { ...base, values: fromPairs(draft.values) };
  if (draft.type === "filter") return { ...base, left: draft.left, operator: draft.operator, right: draft.right };
  return { ...base, seconds: draft.seconds };
}

function Pairs({
  label,
  pairs,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  label: string;
  pairs: Pair[];
  onChange: (pairs: Pair[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const update = (index: number, patch: Partial<Pair>) =>
    onChange(pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)));
  return (
    <fieldset>
      <legend className="mb-1 text-sm text-ink-2">{label}</legend>
      <div className="space-y-2">
        {pairs.map((pair, index) => (
          <div key={index} className="flex gap-2">
            <input
              className="field w-1/3 font-mono"
              placeholder={keyPlaceholder}
              aria-label={`${label} name ${index + 1}`}
              value={pair.key}
              onChange={(event) => update(index, { key: event.target.value })}
            />
            <input
              className="field font-mono"
              placeholder={valuePlaceholder}
              aria-label={`${label} value ${index + 1}`}
              value={pair.value}
              onChange={(event) => update(index, { value: event.target.value })}
            />
            <button
              type="button"
              className="button button-quiet px-2.5"
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              onClick={() => onChange(pairs.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-sm text-ink-2 underline underline-offset-4 hover:text-ink"
          onClick={() => onChange([...pairs, { key: "", value: "" }])}
        >
          Add {label.toLowerCase().replace(/s$/, "")}
        </button>
      </div>
    </fieldset>
  );
}

const initial: FormState = {};

export default function WorkflowEditor({ workflow }: Props) {
  const [state, action, pending] = useActionState(saveWorkflow, initial);
  const [name, setName] = useState(workflow?.name ?? "");
  const [triggerType, setTriggerType] = useState(workflow?.triggerType ?? "manual");
  const [every, setEvery] = useState(String(workflow?.intervalMinutes ?? 15));
  const [steps, setSteps] = useState<Draft[]>(() => workflow?.steps.map(toDraft) ?? [blank("http", "request")]);

  const patch = (target: string, change: Partial<Draft>) =>
    setSteps((current) => current.map((step) => (step.uid === target ? { ...step, ...change } : step)));

  const move = (index: number, delta: number) =>
    setSteps((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + delta, 0, moved);
      return next;
    });

  const add = (type: Step["type"]) =>
    setSteps((current) => {
      const taken = new Set(current.map((step) => step.id));
      let number = current.length + 1;
      while (taken.has(`${type}_${number}`)) number += 1;
      return [...current, blank(type, `${type}_${number}`)];
    });

  const payload = JSON.stringify({
    name,
    triggerType,
    intervalMinutes: triggerType === "schedule" ? every : null,
    steps: steps.map(toStep),
  });

  return (
    <form action={action} className="space-y-8">
      {workflow && <input type="hidden" name="id" value={workflow.id} />}
      <input type="hidden" name="payload" value={payload} />

      <section className="grid gap-4 sm:grid-cols-[1fr_12rem_10rem]">
        <label className="block text-sm">
          <span className="mb-1 block text-ink-2">Name</span>
          <input className="field" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-ink-2">Starts</span>
          <select
            className="field"
            value={triggerType}
            onChange={(event) => setTriggerType(event.target.value as typeof triggerType)}
          >
            <option value="manual">Manually</option>
            <option value="webhook">When a webhook arrives</option>
            <option value="schedule">On a schedule</option>
          </select>
        </label>
        {triggerType === "schedule" && (
          <label className="block text-sm">
            <span className="mb-1 block text-ink-2">Every (minutes)</span>
            <input
              className="field font-mono"
              inputMode="numeric"
              value={every}
              onChange={(event) => setEvery(event.target.value)}
            />
          </label>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium">Steps</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-2">
          Steps run in order. Use <code className="font-mono text-ink">{"{{trigger.body.field}}"}</code> for data sent
          to the webhook and <code className="font-mono text-ink">{"{{steps.step_id.field}}"}</code> for the output of
          an earlier step.
        </p>

        <ol className="mt-4 space-y-3">
          {steps.map((step, index) => (
            <li key={step.uid} className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-end gap-3">
                <span className="pb-2 font-mono text-sm text-ink-3 tabular-nums">{index + 1}</span>
                <label className="block text-sm">
                  <span className="mb-1 block text-ink-2">Type</span>
                  <select
                    className="field"
                    value={step.type}
                    onChange={(event) => patch(step.uid, { type: event.target.value as Step["type"] })}
                  >
                    {STEP_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-ink-2">Step id</span>
                  <input
                    className="field w-44 font-mono"
                    value={step.id}
                    onChange={(event) => patch(step.uid, { id: event.target.value })}
                  />
                </label>
                <div className="ml-auto flex gap-1">
                  <button
                    type="button"
                    className="button button-quiet px-2.5"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Move step ${index + 1} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="button button-quiet px-2.5"
                    disabled={index === steps.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Move step ${index + 1} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={steps.length === 1}
                    onClick={() => setSteps((current) => current.filter((item) => item.uid !== step.uid))}
                    aria-label={`Remove step ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {step.type === "http" && (
                  <>
                    <div className="flex gap-2">
                      <label className="block text-sm">
                        <span className="mb-1 block text-ink-2">Method</span>
                        <select
                          className="field"
                          value={step.method}
                          onChange={(event) => patch(step.uid, { method: event.target.value })}
                        >
                          {METHODS.map((method) => (
                            <option key={method}>{method}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block flex-1 text-sm">
                        <span className="mb-1 block text-ink-2">URL</span>
                        <input
                          className="field font-mono"
                          placeholder="https://api.example.com/items"
                          value={step.url}
                          onChange={(event) => patch(step.uid, { url: event.target.value })}
                        />
                      </label>
                    </div>
                    <Pairs
                      label="Headers"
                      pairs={step.headers}
                      onChange={(headers) => patch(step.uid, { headers })}
                      keyPlaceholder="authorization"
                      valuePlaceholder="Bearer …"
                    />
                    {step.method !== "GET" && (
                      <label className="block text-sm">
                        <span className="mb-1 block text-ink-2">Body (JSON)</span>
                        <textarea
                          className="field min-h-20 font-mono"
                          value={step.body}
                          onChange={(event) => patch(step.uid, { body: event.target.value })}
                        />
                      </label>
                    )}
                  </>
                )}

                {step.type === "transform" && (
                  <Pairs
                    label="Values"
                    pairs={step.values}
                    onChange={(values) => patch(step.uid, { values })}
                    keyPlaceholder="name"
                    valuePlaceholder="{{trigger.body.name}}"
                  />
                )}

                {step.type === "filter" && (
                  <div className="grid gap-2 sm:grid-cols-[1fr_11rem_1fr]">
                    <label className="block text-sm">
                      <span className="mb-1 block text-ink-2">Continue only if</span>
                      <input
                        className="field font-mono"
                        placeholder="{{trigger.body.amount}}"
                        value={step.left}
                        onChange={(event) => patch(step.uid, { left: event.target.value })}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-ink-2">Condition</span>
                      <select
                        className="field"
                        value={step.operator}
                        onChange={(event) => patch(step.uid, { operator: event.target.value })}
                      >
                        {OPERATORS.map((operator) => (
                          <option key={operator} value={operator}>
                            {OPERATOR_LABELS[operator]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {step.operator !== "exists" && (
                      <label className="block text-sm">
                        <span className="mb-1 block text-ink-2">Value</span>
                        <input
                          className="field font-mono"
                          value={step.right}
                          onChange={(event) => patch(step.uid, { right: event.target.value })}
                        />
                      </label>
                    )}
                  </div>
                )}

                {step.type === "delay" && (
                  <label className="block text-sm">
                    <span className="mb-1 block text-ink-2">Wait (seconds)</span>
                    <input
                      className="field w-32 font-mono"
                      inputMode="numeric"
                      value={step.seconds}
                      onChange={(event) => patch(step.uid, { seconds: event.target.value })}
                    />
                  </label>
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-2">Add step:</span>
          {STEP_TYPES.map((type) => (
            <button key={type} type="button" className="button button-quiet" onClick={() => add(type)}>
              {TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </section>

      {state.error && (
        <p role="alert" className="text-sm text-(--critical)">
          {state.error}
        </p>
      )}

      <button className="button button-primary" disabled={pending}>
        {pending ? "Saving…" : workflow ? "Save changes" : "Create workflow"}
      </button>
    </form>
  );
}

# 2. Second `TopologyProvider` implementation: Juniper Mist

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decider:** Corey Robertson

## Context

The connector layer (`src/connect/`) ships a vendor-neutral
`TopologyProvider` contract (`src/connect/types.ts`) with one real
implementation: the EdgeConnect Orchestrator HTTP client
(`src/connect/edgeconnect.ts`), plus the stdio-only fixture `MockProvider`.
The roadmap described the follow-on as "any SD-WAN/SDN controller with a
fabric-state API" — deliberately vendor-neutral, but unchosen. Leaving the
vendor open risks later scoping work treating the second provider as an
abstract placeholder rather than a concrete integration target.

## Decision

The second real `TopologyProvider` implementation is **Juniper Mist**,
targeting **Mist Campus Fabric** and **Mist WAN Assurance**.

- **EdgeConnect Orchestrator remains the first provider.** Nothing about the
  EdgeConnect client, initiative E (live-import hardening), or its sequencing
  changes.
- **This is not a second EdgeConnect client.** Mist is a different vendor and
  product family; a second implementation of the same controller would assert
  the abstraction's neutrality, not prove it.
- **Vendor/product choice only.** No packet scope, API design, credential
  model, or implementation accompanies this decision. Scoping begins only
  when the roadmap promotes the item out of §"Next" — per the existing rule,
  not before the EdgeConnect provider is proven.

## Consequences

- `ROADMAP.md` §"Next" and `IMPLEMENTATION_PLAN.md` (initiative E's deferred
  work) now name Juniper Mist instead of an open-ended "any SD-WAN/SDN
  controller".
- Future provider scoping starts from a named target — Mist Campus Fabric
  and Mist WAN Assurance — instead of re-opening the vendor question.
- No code, packet, tool, or capability claim changes: the Mist provider does
  not exist yet, and no document should describe Mist import as shipped
  until it does.

## Revisit triggers

Reopen this decision only if, when scoping actually begins, Mist's APIs
cannot express the `TopologyProvider` contract's required records
(appliances/devices, tunnels, policies, flows) — that would be evidence
about the abstraction itself, which is the point of a second provider.

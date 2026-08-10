---
name: code-conventions
description: Universal code quality guidelines — SOLID, Clean Code, DDD, TDD, and Clean Architecture. Use when reviewing code design, structuring responsibilities, applying low-coupling/high-cohesion principles, or guiding architectural decisions in any language.
disable-model-invocation: false
---

# Code Quality Conventions

Universal principles for code quality. Apply with good sense, not as dogma.

## Conviction

> Good code is code you can **change without breaking** and that is **documented enough** that anyone (including future you) understands the *why* of decisions.

---

## SOLID

- **S — Single Responsibility**: Each module, class, or function has **one reason to change**. Different responsibilities must be separated.
- **O — Open/Closed**: Open for extension, closed for modification. Add behavior without rewriting existing code (polymorphism, strategies, hooks).
- **L — Liskov Substitution**: Subtypes must replace base types **without breaking correctness**. If a subclass breaks superclass expectations, the design is wrong.
- **I — Interface Segregation**: Small, cohesive interfaces beat large, generic ones. A client should not depend on methods it doesn't use.
- **D — Dependency Inversion**: High-level modules must not depend on low-level modules. Both depend on **abstractions**. Abstractions don't depend on details; details depend on abstractions.

---

## Clean Code

- **Names reveal intent**: `calcularFatura()` not `calc()`, `usuariosAtivos` not `data`. Avoid abbreviations, obscure acronyms, generic names like `dados`, `info`, `temp`.
- **Small, focused functions**: One thing only. Few parameters (0–2 ideal). Early returns over deep nesting. Avoid boolean flags that change internal flow — prefer two distinct functions.
- **No hidden side effects**: Pure functions must not alter global state, files, or databases unexpectedly. Side effects must be clear from name or context.
- **Comments**: Comment the **why**, not the **what**. Code already says what it does. TODO/FIXME without context (issue, date, author) is noise.
- **Error handling**: Never swallow errors. A generic `catch` without log or action is worse than not handling. Use exceptions or explicit results (`Result`, `Either`) over opaque return codes.

---

## Clean Architecture

- **Dependency rule**: Dependencies point **inward**. Business core (domain, entities, use cases) must not depend on frameworks, databases, external libraries, or UI.
- **Responsibility separation**:
  - **Domain**: core business rules, no external dependencies
  - **Use cases**: orchestration of business rules for a specific goal
  - **Adapters / Infra**: concrete implementations of DB, API, UI — swappable details
- **Testability**: Business core must be testable **without DB, network, or framework**. If an entity or use case can only be tested with integration, there's excessive coupling.
- **Ports and adapters**: Define interfaces (ports) for external services in the domain/use cases. Adapters implement those interfaces. Domain doesn't know the adapter.

---

## DDD — Domain-Driven Design

- **Ubiquitous language**: Use the same domain vocabulary in code, discussions, and documentation. A term in code must mean the same to business and tech.
- **Entities and Value Objects**:
  - **Entity**: object with unique identity that persists over time
  - **Value Object**: immutable object defined by its attributes, no identity
  - **Aggregate**: cluster of entities and value objects treated as one consistency unit. An aggregate root enforces invariants
- **Repositories**: abstract storage and retrieval of aggregates. Rich domain: put business logic in entities and value objects, not services. Domain services exist only for operations that don't naturally belong to an entity or value object.

---

## TDD — Test-Driven Development

- **Red-Green-Refactor**:
  1. **Red**: write a failing test before implementing
  2. **Green**: write the minimum code to pass
  3. **Refactor**: improve code without breaking tests
- **What to test**: Observable behavior, not implementation details. Happy paths, error cases, edge cases. Business rules and validations first; I/O integration later (with mocks).
- **Test quality**: Tests must be **fast, deterministic, and isolated**. No trivial tests that always pass without exercising real logic. No generic failure messages. No `skip`/`xfail`/`todo` without explicit justification.

---

## Evaluation Criteria

| Level | Meaning |
|---|---|
| **ERROR** | Violates the central conviction: introduces bug risk, breaks dependency rule, or makes change dangerous. |
| **WARNING** | Violates one or more principles above, but no immediate functional risk. Technical debt. |
| **SUGESTION** | Could be clearer, more cohesive, or more consistent with principles, but is functionally correct. |

---

## Final Rule

This skill does not override toolchain or operational conventions defined in `AGENTS.md`. It serves as a **design quality guide** — apply principles with good sense, not as dogma.

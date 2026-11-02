# @trace/vendors

Every external vendor sits behind an interface with a mock implementation (CLAUDE.md "Vendors behind interfaces"): `SttProvider`, `CodeRunner`, `LlmGrader`, `Messaging`, `Payments`, and the error reporter's adapter. Each interface and its mock arrive with the milestone that first needs it. Choosing a vendor needs an ADR.

From D1 (`specs/d1-demo-slice.md` §5.3): `LlmGrader` with the deterministic `MockLlmGrader` (`mock-grader-v1`), and `Messaging` with the demo `OutboxMessaging`, which refuses any environment but `dev` and `staging`.

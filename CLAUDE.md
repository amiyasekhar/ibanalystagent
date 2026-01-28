	•	Read relevant files before answering or changing anything. Never speculate about code you haven’t opened.
	•	Workflow: read → propose plan + scope → get approval for major changes → implement minimal diff → summarize + verify → update architecture doc (if needed).
	•	Keep changes minimal and localized. Avoid complex refactors.
	•	No drive-by refactors: do not rename, reformat, reorganize, or “clean up” unrelated code. No “while I’m here” improvements unless asked.
	•	Major change definition (requires approval first): touching >3 files, changing public APIs/routes, DB schema, adding dependencies, or refactors not strictly required for the task.
	•	Before coding, list: files you will open + files you expect to modify (with reasons).
	•	After coding, provide: files changed + what changed + behavior impact + verification steps (tests or manual).
	•	Dependencies: don’t add deps unless necessary; don’t modify lockfiles unless deps change.
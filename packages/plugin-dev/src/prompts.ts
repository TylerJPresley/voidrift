/**
 * Plugin-dev template registrations.
 * Registers document templates for development workflow artifacts.
 */

interface TemplateRegistrar {
  registerTemplate(key: string, content: string, label?: string, description?: string): void;
}

export function registerDevTemplates(registrar: TemplateRegistrar): void {
  registrar.registerTemplate("doc-bug", TEMPLATE_BUG, "Bug Report", "QA failure bug report format");
  registrar.registerTemplate("doc-verify-plan", TEMPLATE_VERIFY_PLAN, "Verify Plan", "QA test plan format");
  registrar.registerTemplate("doc-task", TEMPLATE_TASK, "Task", "Implementation task ticket format");
  registrar.registerTemplate("doc-idea", TEMPLATE_IDEA, "Idea", "Product idea brief format");
  registrar.registerTemplate("doc-cr", TEMPLATE_CR, "Change Request", "Architecture change request format");
}

// ─── Document Templates ──────────────────────────────────────────────────────

const TEMPLATE_BUG = `---
id: ""
requirement: ""
status: "FAIL"
created_at: "{{harness.timestamp}}"
---
# Bug Report

**Date:** {{harness.timestamp}}
**Requirement:** 
**Status:** FAIL

## What Was Tested

## Scenario Steps Executed

## Expected vs Actual

## Process Output at Time of Failure

## Stack Trace

## Notes
`;

const TEMPLATE_VERIFY_PLAN = `---
created_at: "{{harness.timestamp}}"
session: "{{session.uuid}}"
---
# Verification Plan

## System Context

## Test Scenarios
`;

const TEMPLATE_TASK = `---
id: TASK-{{task.id}}
title: ""
priority: now
status: pending
created_at: {{harness.timestamp}}
depends: []
---
## Objective


## Acceptance Criteria
- [ ] 

## Notes
`;

const TEMPLATE_IDEA = `---
id: IDEA-{{idea.id}}
title: ""
status: draft
created_at: {{harness.timestamp}}
---
## Problem


## Proposed Solution


## Open Questions
`;

const TEMPLATE_CR = `---
id: CR-{{cr.id}}
title: ""
status: draft
priority: normal
created_at: {{harness.timestamp}}
depends: []
modules: []
---
## Summary


## Motivation


## Changes Required
- [ ] 

## Acceptance Criteria
- [ ] 
`;

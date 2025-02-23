# ACL Implementation Learnings

## Overview
This document captures key learnings and insights from implementing and fixing ACL (Access Control List) functionality in LoopBack.

## Core Concepts

### ACL Model
- Provides granular access control for models and their properties
- Each ACL entry defines:
  - Principal (who: user, role, scope)
  - Model (what resource)
  - Property (which part of the resource)
  - AccessType (how: read, write, execute, etc.)
  - Permission (allow/deny)

### Permission Resolution
1. ACLs are ordered by matching score
2. For equal scores, role precedence is considered
3. Specific access types take precedence over wildcards
4. First match is used for non-wildcard requests

### Role Hierarchy
From strongest to weakest:
1. Custom roles (highest precedence)
2. Owner
3. Related
4. Authenticated
5. Everyone (lowest precedence)

## Key Findings

### Static ACLs
- Can be defined at model level or property level
- Model-level ACLs apply to all properties unless overridden
- Property-level ACLs take precedence over model-level ACLs
- Multiple ACLs can be defined for same principal/resource

### Permission Precedence
1. Explicit DENY takes precedence
2. Explicit ALLOW follows
3. DEFAULT falls back to model's defaultPermission
4. If no defaultPermission, system default is DENY

### Common Issues

#### Issue 1: Wildcard Permission Resolution
- Original behavior: Wildcards were not properly handled in permission resolution
- Fix: Implemented proper wildcard matching with scoring system
- Test case: "should allow access to models for the given principal by wildcard"

#### Issue 2: Static ACL Inheritance 
- Original behavior: Static ACLs from model not properly inherited
- Fix: Changed ACL resolution to properly cascade from model to property level
- Test case: "should honor static ACLs from the model"

#### Issue 3: Role-Based Access
- Original behavior: Role precedence not properly enforced
- Fix: Implemented role hierarchy in permission resolution
- Test case: "should check access against LDL, ACL, and Role"

## Best Practices

### ACL Definition
1. Start with default DENY
2. Add explicit ALLOW rules for required access
3. Use wildcards carefully - be specific when possible
4. Consider role hierarchy when designing permissions

### Testing
1. Test explicit allow/deny combinations
2. Test wildcard behavior
3. Test role inheritance
4. Test property vs model level ACLs
5. Test default permission fallback

### Performance Considerations
- ACLs are evaluated in order
- More specific rules should come first
- Minimize use of wildcards
- Cache common permission checks

## Failed Attempts & Lessons

### Attempt 1: Simple Role Override
- Tried to make role permissions override all others
- Failed because it broke wildcard inheritance
- Lesson: Need to consider both role hierarchy and wildcard specificity

### Attempt 2: Strict Ordering
- Implemented strict order of evaluation
- Failed because it was too rigid for complex scenarios
- Lesson: Need flexible scoring system that considers multiple factors

### Attempt 3: Permission Scoring
- Initial scoring system too simple
- Failed to handle edge cases with mixed wildcards
- Lesson: Scoring needs to consider:
  - Match specificity
  - Role strength
  - Access type specificity

## Future Improvements

### Suggested Enhancements
1. Caching layer for common permission checks
2. Better handling of inherited roles
3. More granular wildcard matching
4. Improved error messages and debugging
5. Performance optimizations for large ACL sets

### Open Questions
1. How to better handle dynamic roles?
2. Should we support negative wildcards?
3. How to optimize permission checking for high-traffic scenarios?
4. Better ways to test complex ACL combinations?

## References
- Original test file: original/acl.test-org.js
- Current implementation: test/acl.test.js
- ACL model definition: common/models/acl.js

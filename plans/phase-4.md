# Phase 4 Documentation: Analysis & Action Plan for Migration to Promises

## Introduction

This documentation summarizes a comprehensive analysis comparing the current implementations of the Change, Utils, and Persisted-Model modules with their original callback-based implementations. The focus has been on replication-related functionalities, error propagation, and differences in control flow after migrating to promises.

## Summary of Findings

### Change Module
- **Original Implementation:**
  - Utilized async.waterfall and callback-based error propagation in methods such as `rectifyModelChanges`, `findOrCreateChange`, and `rectify`.
  - Aggregated errors by collecting them in an array and invoking the final callback with either a composite error or success.

- **Promise-based Implementation:**
  - Converted to async/await routines with Promise.all and direct error throwing instead of callback errors.
  - Conflict resolution methods (resolve, resolveUsingSource/Target, swapParties) follow a similar logic but now use promise rejections.

- **Observations:**
  - The overall business logic remains unchanged.
  - There is a risk of timing differences due to the shift from callback to promise propagation, which might affect some conflict scenarios.

### Utils Module
- **Original Implementation:**
  - Functions like `uploadInChunks` and `downloadInChunks` were implemented using callbacks and async.waterfall.
  - Relied on nested callbacks to process chunks and aggregate results using a `concatResults` helper.

- **Promise-based Implementation:**
  - Converted to async/await style for clearer control flow.
  - **Bug:** In `uploadInChunks`, when processing chunks an error in a conflict scenario isn't correctly handled: 
    - An undeclared variable `aggregatedConflicts` is referenced intended for aggregating conflict details.
    - There is a mismatch with the error variable name in the catch block leading to unexpected behavior.

- **Observations:**
  - This bug might cause the function to reject the entire promise instead of gracefully handling and aggregating conflicts as in the original implementation.

### Persisted-Model Module (Replication-Related Functionality)
- **Original Implementation:**
  - Replication workflows (checkpoint creation, diff computation, bulk updates, conflict resolution) were implemented using callbacks.
  - Used sequential and parallel flows (via async.waterfall/async.parallel) to perform replication steps.

- **Promise-based Implementation:**
  - Replication methods now employ async/await with a retry loop (MAX_ATTEMPTS = 3) to reattempt replication if updates remain and no conflicts are present.
  - Error handling is done via promise rejections.

- **Observations:**
  - The introduction of a retry loop may change behavior compared to the original single-pass replication.
  - Strict update count checking in methods like bulk updates may trigger errors differently than before.
  - Differences in timing and error propagation might influence conflict detection and resolution when interfacing with various connectors.

## Prioritized Action Plan

1. **(High Priority) Fix the Utils Module `uploadInChunks` Bug**
   - Review the error handling path in `uploadInChunks`.
   - Correct the reference to `aggregatedConflicts` by properly declaring and initializing it.
   - Ensure the error variable in the catch block correctly reflects the thrown error.

2. **(Medium-High Priority) Validate Replication Retry Loop Behavior**
   - Test the replication process across different connectors to verify the retry loop behaves as expected.
   - Compare the conflict resolution results and update counts with those from the original implementation.
   - Adjust the retry parameters (such as MAX_ATTEMPTS) or error handling if discrepancies are found.

3. **(Medium Priority) Review Effects of Promise-based Error Propagation**
   - Evaluate how promise rejections versus callback errors affect overall application logic and conflict handling.
   - Update any dependent client code/documentation to reflect the new promise-based APIs.

4. **(Medium Priority) Comprehensive Testing of Replication Workflows**
   - Develop integration tests that cover replication, including checkpoint creation, diff computation, bulk updates, and conflict resolution.
   - Simulate various conflict scenarios to ensure that the migration to promises does not degrade replication fidelity.

5. **(Lower Priority) Update Documentation and Client Guidelines**
   - Revise internal and external documentation to describe the new promise-based implementation.
   - Provide guidance on migrating from callback-based patterns to async/await in client code.

## Conclusion

Migrating from callbacks to promises has modernized the codebase and streamlined the control flow. However, the changes introduced discrepancies, particularly in error aggregation within the Utils module and modifications in the replication workflow (retry loop and strict update count checks). Addressing these issues as per the prioritized action plan will help ensure that replication functionalities remain robust and consistent with the original behavior. 
# Technical oracle amendment v3.1

The v3 notification calibration naturally settled in 325.7 seconds, with all current storage/MCP/web CI suites green and locked inputs preserved. The original final acceptance failed because its disposable import instrumentation replaced `src/import.mjs` with a wrapper exporting only `importNotes`. Pi had legally added and used `exportNotes` in both services. The wrapper removed that export and crashed the instrumented copy; delivered source remained unchanged.

The amendment forwards all extra named exports, an optional default export, and function `this` when wrapping `importNotes`. The wrapper records shared-helper use on a disposable acceptance copy only. Reference, actual N app, export-rich/default-importing app and alternative valid error/status/entity implementations each pass all nine corrected acceptance checks offline.

The original N result, timings, oracle output and source manifest remain unchanged. Corrected offline acceptance establishes application correctness after review; it does not retroactively create a complete verified time or an eligible efficiency pair. No provider rerun or operator steering occurred. V1/v2/v3 sources remain archived under inputs/.

Application contract, scaffold, shared-helper regression, model prompt/tools, queue timing and runtime are unchanged. All measured runs use the same final v3.1 manifest and oracle. Original calibration attempts are excluded from measured summaries.

Evidence: [original result](runs/calibration-p0-N-a1/result.json), [original oracle](runs/calibration-p0-N-a1/oracle.json), [assessment](runs/calibration-p0-N-a1/assessment.json), [corrected actual app](offline/v3.1/n-corrected-offline.json), [export-rich/default fixture](offline/v3.1/extra-exports-corrected.json).

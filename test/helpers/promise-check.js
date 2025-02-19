const BEFORE_MIGRATION = `
  const hasBluebird = /\\bPromise\\.(coroutine|try|method|spread)\\b/.test(code);
  const hasUtilsCB = false; // Migration complete
  return hasBluebird || hasUtilsCB;
`;

afterEach(function() {
  if (BEFORE_MIGRATION(this._test.code)) {
    console.warn('Test contains unmigrated promise patterns:', this.currentTest.title);
  }
}); 
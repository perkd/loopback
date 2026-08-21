// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const async = require('async');
const loopback = require('../');
const expect = require('./helpers/expect');

const Checkpoint = loopback.Checkpoint.extend('TestCheckpoint');

describe('Checkpoint', function() {
  describe('bumpLastSeq() and current()', function() {
    beforeEach(function() {
      const memory = loopback.createDataSource({
        connector: loopback.Memory,
      });
      Checkpoint.attachTo(memory);
    });

    it('returns the highest `seq` value', async function() {
      await Checkpoint.bumpLastSeq();
      await Checkpoint.bumpLastSeq();
      const seq = await Checkpoint.current();
      expect(seq).to.equal(3);
    });

    it('Should be no race condition for current() when calling in parallel', async function() {
      await Promise.all([
        Checkpoint.current(),
        Checkpoint.current()
      ]);

      const data = await Checkpoint.find();
      expect(data).to.have.length(1);
    });

    it('Should be no race condition for bumpLastSeq() when calling in parallel', async function() {
      const list = await Promise.all([
        Checkpoint.bumpLastSeq(),
        Checkpoint.bumpLastSeq()
      ]);

      const data = await Checkpoint.find();
      // The invariant "we have at most 1 checkpoint instance" is preserved
      expect(data).to.have.length(1);
      // There is a race condition here, we could end up with both 2 or 3 as the "seq".
      expect(data[0].seq).to.equal(2);
      // Both results should be 2 in this case
      expect(list).to.eql([2, 2]);
    });

    it('Checkpoint.current() for non existing checkpoint should initialize checkpoint', async function() {
      const seq = await Checkpoint.current();
      expect(seq).to.equal(1);
    });

    it('bumpLastSeq() works when singleton instance does not exists yet', async function() {
      const cp = await Checkpoint.bumpLastSeq();
      // We expect `seq` to be 2 since `checkpoint` does not exist and
      // `bumpLastSeq` for the first time not only initializes it to one,
      // but also increments the initialized value by one.
      expect(cp).to.equal(2);
    });
  });
});

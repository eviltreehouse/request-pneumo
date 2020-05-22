'use strict';
const assert = require('assert');
const Pneumo = require('../lib/request-pneumo');

describe('Baseline Tests', () => {
	let req;
	before(() => {
		req = new Pneumo('testing');
	});

	after(() => {
		req = null;
	});

	it('Instance OK', () => {
		assert(req instanceof Pneumo);
		assert.strictEqual(req.context, 'testing');
	});

	it('Instance default config OK', () => {
		assert.strictEqual(req.defaultTimeout, undefined);
		assert.strictEqual(req.localFallback, false);
		assert.strictEqual(req.responseDecoder.name, 'decodeNone');
	});
});
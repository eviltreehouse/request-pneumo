'use strict';
const assert = require('assert');
const Pneumo = require('../lib/request-pneumo');
const Proxy  = require('../lib/proxy');

describe('RequestPneumo Baseline Tests', () => {
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

describe('Proxy Baseline Tests', () => {
	it('Throws on invalid type', () => {
		try {
			new Proxy('testing', 'zyzzy', 'localhost', '8080');
			throw new Error('did not throw on new()');
		} catch(err) {
			assert(err.message.match(/^Proxy type not supported/));
		}
	});

	it('HTTP Instance OK', () => {
		const p = new Proxy('testing', 'http', 'localhost', '8080', 'uname', 'pwd');
		assert(p instanceof Proxy);
		assert(p.type === 'http');
		assert(p.host === 'localhost');
		assert(p.port === 8080);
		assert(p.username === 'uname');
		assert(p.password === 'pwd');
	});

	it('HTTPS Instance OK', () => {
		const p = new Proxy('testing', 'https', 'localhost', '8080');
		assert(p instanceof Proxy);
		assert(p.type === 'https');
		assert(p.port === 8080);
	});

	it('SOCKS5 Instance OK', () => {
		const p = new Proxy('testing', 'socks5', 'localhost', '1080');
		assert(p instanceof Proxy);
		assert(p.type === 'socks5');
		assert(p.port === 1080);
	});
});
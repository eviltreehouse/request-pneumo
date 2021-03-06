'use strict';
const request = require('simple-get');
const Proxy = require('./proxy');

/** @typedef {import('http').Agent} HttpAgent */

const ROTATION_METHODS = ['static','random','round-robin','single'];

// Use AWS since it's probably not going anywhere and is probably multi-homed
// for performance from any AZ:
const DEFAULT_IPCHECK_ENDPOINT = 'https://checkip.amazonaws.com/';

const sortRand = () => Math.random() - Math.random();
const sortLastReqTime = (a,b) => a.lastRequestTime - b.lastRequestTime;
const sortNone = () => 0;

const proxyOk = () => true;

const decodeUtf8 = (b) => b.toString('utf8');
const decodeJSON = (b) => {
	try {
		return JSON.parse(b.toString('utf8'));
	} catch(err) {
		return {};
	}
}
const decodeNone = (b) => b;

/** @typedef {{
 localFallback?: boolean,
 defaultTimeout?: number,
 proxyRotationMethod?: string,
 decodeResponse?: string,
}} RequestPneumoConfig */

class RequestPneumo {
	/**
	 * @param {string} [context]
	 * @param {RequestPneumoConfig} [config]
	 */
	constructor(context, config) {
		this.context = context || 'default';
		config = config || {};

		/** @type {Object.<string,Proxy>} */
		this.proxies = {};
		this.localFallback = config.localFallback === true;
		this.noProxy = new Proxy('_local', 'no-proxy', '127.0.0.1', '11111');

		this.defaultTimeout = parseInt(config.defaultTimeout) || undefined;

		/** @type {boolean} */
		this.lastProxySuccess = null;

		/** @type {function(Object<string,any>, string, string): boolean} */
		this.proxyEval = proxyOk;
		if (config.evaluator) this.setProxyEvaluator(config.evaluator);

		if (config.proxyRotationMethod && ROTATION_METHODS.includes(config.proxyRotationMethod)) {
			this.rotationMethod = config.proxyRotationMethod;
		} else this.rotationMethod = 'static';

		/** @type {function(Buffer): any} */
		this.responseDecoder = decodeNone;
		if ([true, 'utf8'].includes(config.decodeResponse)) this.responseDecoder = decodeUtf8;
		else if (config.decodeResponse === 'json') this.responseDecoder = decodeJSON;

		/** @type {Object.<string, [number, number]>} */
		this.proxyStats = {};
	}

	/**
	 * @param {function(Object<string,any>, string): boolean} f
	 * @return {this}
	 */
	setProxyEvaluator(f) {
		if (f && typeof f === 'function') this.proxyEval = f;
		else this.proxyEval = proxyOk;
		return this;
	}

	resetProxyStats() {
		for (let k of this.proxyStats) {
			this.proxyStats[k][0] = 0;
			this.proxyStats[k][1] = 0;
		}
	}

	/**
	 * @return {boolean}
	 */
	async prepare() {
		for (let k in this.proxies) await this.proxies[k].createAgent();

		return true;
	}

	/**
	 * @return {Proxy[]}
	 * @future pull out entries that have too many errors (cooldown?)
	 */
	loadProxyCandidates() {
		const c = [];
		for (let k in this.proxies) {
			const p = this.proxies[k];
			if (p.getAgent() && p.hostIp) c.push(p);
		}

		return c;
	}

	/**
	 * @param {Proxy[]} proxies
	 * @param {Object.<string,any>} requestOpts
	 * @return {Proxy[]}
	 */
	filterProxyCandidates(proxies, requestOpts) {
		let filtered = proxies.filter(p => this.proxyEval(requestOpts, p.id, this.context));

		let sortFunc;
		switch (this.rotationMethod) {
			/** try to keep all proxies routinely engaged */
			case 'round-robin':
				sortFunc = sortLastReqTime;
				break;
			/** shuffle */
			case 'random':
			case 'single':
				sortFunc = sortRand;
				break;
			/** use the list in the order we have defined them: will only work downward on failure */
			case 'static':
			default:
				sortFunc = sortNone;
				break;

		}

		const sorted = filtered.sort(sortFunc);
		return this.rotationMethod === 'single' ? sorted.slice(0, 1) : sorted;
	}

	/**
	 * @param {Object.<string,any>} opts
	 * @return {[Error, Response, Buffer | String]}
	 */
	async request(opts) {
		const proxyCandidates = this.filterProxyCandidates(this.loadProxyCandidates(), opts);
		// Add the "no-proxy" if we have the local fallback option enabled:
		if (this.localFallback) proxyCandidates.push(this.noProxy);

		if (proxyCandidates.length === 0) return [ new Error('No valid proxy candidates for this request.'), null, null ];

		while (proxyCandidates.length > 0) {
			const proxy = proxyCandidates.shift();
			const proxyId = proxy.id;
			if (! this.proxyStats[proxyId]) this.proxyStats[proxyId] = [0,0];

			let [err, res, data] = await this.requestVia({ ...opts }, proxy, this.responseDecoder);
			if (err) {
				if (! this.wasProxyError(err, res)) {
					return [ err, res, null ];
				} else {
					this.proxyStats[proxyId][1]++;
				}
			} else {
				this.proxyStats[proxyId][0]++;
				return [null, res, data];
			}
		}

		return [new Error('No successful proxy requests.'), null, null ];
	}

	/**
	 * Gets an `Http.Agent` for use with an external request handler that's bound
	 * to one of the random candidate proxies. _Note:_ this will this the proxies
	 * "last usage time" so that metrics and/or rotation logic will still function.
	 * @param {Object.<string,any>} opts
	 * @return {HttpAgent}
	 */
	requestAgent(opts) {
		const proxyCandidates = this.filterProxyCandidates(this.loadProxyCandidates(), opts);
		if (proxyCandidates.length === 0) return null;
		else {
			const proxy = proxyCandidates[0];
			proxy.lastRequestTime = Date.now();
			return proxy.getAgent();
		}
	}

	/**
	 * Run an IP check through each proxy and capture the result.
	 * @param {string} [endpoint]
	 * @return {Object.<string, string>[]}
	 */
	async validateProxies(endpoint) {
		const proxies = this.loadProxyCandidates();
		const results = {};

		// use AWS if we didn't specify anything else...
		if (! endpoint) endpoint = DEFAULT_IPCHECK_ENDPOINT;

		const validationRequest = {
			'method': 'GET',
			'url': endpoint
		};

		for (let p of proxies) {
			const [err, res, data] = await this.requestVia(validationRequest, p, decodeUtf8);
			if (err) results[p.id] = false;
			else results[p.id] = data.trim();
		}

		return results;
	}

	/**
	 * @param {Error} err
	 * @param {Response} res
	 * @return {boolean}
	 */
	wasProxyError(err, res) {
		if (err.code === 'ECONNREFUSED') return true; // could not establish connection
		else if (res && res.statusCode === 407) return true; // got proxy access denied
		else if (err.options && err.options.command === 'connect') return true; // SOCKS5 connect issue
		else return false; // not sure but can't tell...
	}

	/**
	 * @param {Object.<string,any>} opts
	 * @param {Proxy} proxy
	 * @param {function(Buffer): any} [decoder]
	 * @return {Promise<any[]>}
	 */
	requestVia(opts, proxy, decoder) {
		if (! decoder || typeof decoder !== 'function') decoder = decodeNone;
		this.lastProxySuccess = null;
		proxy.lastRequestTime = Date.now();

		return new Promise(async (resolve) => {
			opts['agent'] = proxy.getAgent();
			if (opts['timeout'] == undefined && this.defaultTimeout) opts['timeout'] = this.defaultTimeout;

			request.concat(opts, (err, res, data) => {
				if (err) {
					this.lastProxySuccess = false;
					resolve([err, null, null]);
				} else if (res.statusCode > 299) {
					this.lastProxySuccess = false;
					resolve([new Error(res.statusCode), res, decoder(data)]);
				} else {
					this.lastProxySuccess = true;
					resolve([null, res, decoder(data)]);
				}
			});
		});
	}

	/**
	 * @param {string} id
	 * @param {string} hostname
	 * @param {number} port
	 * @param {string} [username]
	 * @param {string} [password]
	 * @return {this}
	 */
	async addHttpProxy(id, hostname, port, username, password) {
		if (this.proxies[id]) throw new Error(`${id} already defined`);
		this.proxies[id] = new Proxy(id, 'http', hostname, port, username, password);
		await this.proxies[id].createAgent();
		return this;
	}

	/**
	 * @param {string} id
	 * @param {string} hostname
	 * @param {number} port
	 * @param {string} [username]
	 * @param {string} [password]
	 * @return {this}
	 */
	async addHttpsProxy(id, hostname, port, username, password) {
		if (this.proxies[id]) throw new Error(`${id} already defined`);
		this.proxies[id] = new Proxy(id, 'https', hostname, port, username, password);
		await this.proxies[id].createAgent();
		return this;
	}

	/**
	 * @param {string} id
	 * @param {string} hostname
	 * @param {number} port
	 * @param {string} [username]
	 * @param {string} [password]
	 * @return {this}
	 */
	async addSocks5Proxy(id, hostname, port, username, password) {
		if (this.proxies[id]) throw new Error(`${id} already defined`);
		this.proxies[id] = new Proxy(id, 'socks5', hostname, port, username, password);
		await this.proxies[id].createAgent();
		return this;
	}
}

module.exports = RequestPneumo;
'use strict';
const request = require('simple-get');
const Response = require('http').ServerResponse;

const IP_CHECK_ENDPOINT = 'https://checkip.amazonaws.com/';

const sortRand = () => Math.random() - Math.random();

const Proxy = require('./proxy');
/** @typedef {{
 localFallback?: boolean,
 defaultTimeout?: number
}} RequestPneumoConfig */

/** @type {RequestPneumo} */
let rp;

class RequestPneumo {
	/**
	 *
	 * @param {RequestPneumoConfig} config
	 */
	constructor(config) {
		/** @type {Object.<string,Proxy>} */
		this.proxies = {};
		this.localFallback = config.localFallback === true;
		this.defaultTimeout = parseInt(config.defaultTimoeout) || undefined;

		/** @type {string} */
		this.lastProxyId = null;

		/** @type {boolean} */
		this.lastProxySuccess = null;

		/** @type {function(Object<string,any>, string): boolean} */
		this.proxyEval = null;

		/** @type {Object.<string, [number, number]>} */
		this.proxyStats = {};
	}

	/**
	 * @param {function(Object<string,any>, string): boolean} f 
	 * @return {this}
	 */
	setProxyEvaluator(f) {
		this.proxyEval = f;
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
	 * @param {Object.<string,any>} opts
	 * @return {Proxy[]}
	 */
	loadProxyCandidates(opts) {
		const c = [];
		for (let k in this.proxies) {
			const p = this.proxies[k];
			if (p.getAgent() && p.hostIp) {
				if (!this.proxyEval || this.proxyEval(opts, p.id)) {
					c.push(p);
				}
			}
		}

		/** @todo -- support weighting in some intelligent way */
		return c.sort(sortRand);
	}

	/**
	 * @param {Object.<string,any>} opts
	 * @return {[Error, Response, Buffer | String]}
	 */
	async request(opts) {
		const proxyCandidates = this.loadProxyCandidates(opts);
		if (proxyCandidates.length === 0) return [new Error('No proxy candidates.'), null, null ];

		while (proxyCandidates.length > 0) {
			const proxy = proxyCandidates.shift();
			const proxyId = proxy.id;
			if (! this.proxyStats[proxyId]) this.proxyStats[proxyId] = [0,0];

			try {
				let [res, data] = await this.requestVia({ ...opts }, proxy);
				this.proxyStats[proxyId][0]++;
				return [null, res, data];
			} catch(e) {
				let [err, res] = e;
				if (! this.wasProxyError(err, res)) {
					return [ err, res, null ];
				} else {
					this.proxyStats[proxyId][1]++;
					continue;
				}
			}
		}

		return [new Error('No successful proxy requests.'), null, null ];
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
	 * @return {Promise<Buffer>}
	 */
	requestVia(opts, proxy) {
		this.lastProxySuccess = null;
		this.lastProxyId = proxy.id;
		return new Promise((resolve, reject) => {
			opts['agent'] = proxy.getAgent();
			if (opts['timeout'] == undefined && this.defaultTimeout) opts['timeout'] = this.defaultTimeout;

			request.concat(opts, (err, res, data) => {
				if (err) {
					this.lastProxySuccess = false;
					reject([err, null]);
				} else if (res.statusCode > 299) {
					this.lastProxySuccess = false;
					reject([null, res]);
				} else {
					this.lastProxySuccess = true;
					resolve([res, data]);
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
	addHttpProxy(id, hostname, port, username, password) {
		if (this.proxies[id]) throw new Error(`${id} already defined`);
		this.proxies[id] = new Proxy(id, 'http', hostname, port, username, password);
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
	addHttpsProxy(id, hostname, port, username, password) {
		if (this.proxies[id]) throw new Error(`${id} already defined`);
		this.proxies[id] = new Proxy(id, 'https', hostname, port, username, password);
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
	addSocks5Proxy(id, hostname, port, username, password) {
		if (this.proxies[id]) throw new Error(`${id} already defined`);
		this.proxies[id] = new Proxy(id, 'socks5', hostname, port, username, password);
		return this;
	}
}

/**
 * @param {RequestPneumoConfig} config
 * @return {RequestPneumo}
 */
module.exports = (config) => {
	if (rp) return rp;

	rp = new RequestPneumo(config || {});
	return rp;
};
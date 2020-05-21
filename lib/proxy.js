'use strict';
const { promisify } = require('util');
const lookup = promisify(require('dns').lookup);
const url = require('url');

const SUPPORTED_TYPES = ['http', 'https', 'socks5', 'no-proxy'];

const HttpProxyAgent = require('https-proxy-agent');
const SocksProxyAgent = require('node-socks-proxy-agent');

const isSupported = (t) => SUPPORTED_TYPES.indexOf(t) > -1;

const validV4Ip = (v) => v.toString().match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);

class Proxy {
	/**
	 *
	 * @param {string} id
	 * @param {string} type
	 * @param {string} host
	 * @param {number} port
	 * @param {string} [username]
	 * @param {string} [password]
	 */
	constructor(id, type, host, port, username, password) {
		if (! id || ! type || ! host || ! port) throw new Error('Missing required parameters');
		if (! isSupported(type)) throw new Error('Proxy type not supported. Valid types: ' + SUPPORTED_TYPES.join(', '));

		this.id = id;
		this.type = type;
		this.host = host;
		this.hostIp = null;

		this.requestCount = 0;
		this.lastRequestTime = 0;

		if (validV4Ip(this.host)) this.hostIp = this.host;
		else if (this.type === 'http' || this.type === 'https') this.hostIp = this.host;

		/** @type {HttpProxyAgent} */
		this.http_agent = null;

		/** @type {SocksProxyAgent} */
		this.socks_agent = null;

		this.port = port;
		this.username = username || null;
		this.password = password || null;
	}

	getAgent() {
		if (this.type === 'http' || this.type === 'https') return this.http_agent;
		else if (this.type === 'socks5') return this.socks_agent;
		else if (this.type === 'no-proxy') return undefined;
	}

	/**
	 * @return {this}
	 */
	async createAgent() {
		switch (this.type) {
			case 'http':
			case 'https':
				const proxyUrl = url.format({
					protocol: this.type === 'https' ? 'https' : 'http',
					hostname: this.host,
					port: this.port,
					pathname: '',
					auth: this.username ? [this.username || '', this.password || ''].join(":") : undefined,
				});

				this.http_agent = new HttpProxyAgent(proxyUrl);
				break;

			case 'socks5':
				this.socks_agent = new SocksProxyAgent({
					protocol: 'socks:',
					host: await this.resolveHost(), // no resolution layer between us and the `socks` lib
					port: this.port,
					auth:  this.username ? [this.username || '', this.password || ''].join(':') : undefined
				});
				break;
			case 'no-proxy':
			default:
				/* no-op */
				break;
		}

		return this;
	}

	/**
	 * @return {string}
	 */
	async resolveHost() {
		try {
			this.hostIp = (await lookup(this.host)).address;
		} catch(e) {
			this.hostIp = null;
		}

		return this.hostIp;
	}
}

module.exports = Proxy;
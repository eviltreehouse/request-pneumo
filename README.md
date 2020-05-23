# request-pneumo: Pneumatically-powered proxy persistence
by: [Corey Sharrah <corey@eviltreehouse.com>](mailto:corey@eviltreehouse.com)

## Abstract

`request-pneumo` is a wrapper module of sorts that provides a proxy confiuration/agent management layer with a handy cascading request API powered by [feross/simple-get](https://github.com/feross/simple-get). It supports some lightweight selection logic that allows for customization of how proxies are elected and ordered, as well as provides an open-ended _"evaluator"_ function so you may programmatically revoke a proxy from the list of candidates based on specifics on the pending request (e.g., only use `my-proxy.co.uk` for `co.uk` domains, or only use proxies with an >85% success rate, etc.)


## Example
```javascript
const RequestPneumo = require('request-pneumo');

const req = new RequestPneumo('local', {
	localFallback: false, // set to TRUE if you want to make a 
	                      // direct request if all proxy options fail.
	decodeResponse: 'utf8', // default is to return Buffer, can also 
                            // `json` parse into an Object.
	
	proxyRotationMethod: 'random', // shuffle them
	// 'round-robin', try to use them all equally
	// 'static', always use them in the order I defined them (see below)
});

// set up our evaluator so we can ensure a particular proxy won't
// be used for a specific domain.
req.setProxyEvaluator((requestOpts, proxyId) => {
	if (requestOpts.url.match(/thatonesite.io/) && proxyId !== 'special-proxy') return false;
	return true;
});
// Set `null` to switch back to the `() => true` default behavior.

!!async function() {
	const username = 'my-proxy-username';
	const password = 'p@ssw0rd!!';

	// add a proxy of each supported type
	// order isn't relevant unless you are using `static` mode, in which case you
	// would put the high-priority ones towards the top.
	await req.addHttpProxy('http-01', 'http-prx.local', 8080, username, password);
	await req.addHttpsProxy('https-01', 'secure-prx.local', 8443, username, password);
	await req.addSocks5Proxy('socks-01', 'socks-prx.remote.io', 1080, username, password);

	// dump the IP address observed by an endpoint server for each defined proxy.
	console.log(await req.validateProxies('<custom URL - default is AWS>'));
	
	// If you want to use your own `http.Request`-style handler, just export an 
	// `Agent` object for an elected proxy. 
	const agent = req.requestAgent();
	
	// Otherwise use our request API powered by `simple-get`.
	// In the event of a failure that's considered to be proxy-ish in
	// nature, it will try the next one in the list. 
	const [err, resp, data] = await req.request({ 'url': 'https://www.thatonesite.io/latest-news', method: 'GET' });
	if (err) console.error('no luck with any of our proxies...', err);
	else {
		console.log(`=== Got HTTP ${resp.statusCode}:`);
		console.log('='.repeat(40));
		console.log(data);
		console.log('='.repeat(40));
	}
}();
```

## Use Cases
- Turn-key anonymity+availablity (with a suitable proxy service provider), but...
- __Do No Harm :)__ Using this to try to request-flood or any other such anti-social behavior is only going to get you banned from your service provider.
- Regional service availability monitoring
- Outbound load-balancing of heavy request volume


## Future
- "Sticky" proxies: ensure requests of a certain context always come from the same proxy (currently you can use the `getAgent()` method and your own request layer to do this.) 
- Better stats functionality: for now it just captures attempts/successes
- Auto-throttling candidates: Set a threshold that takes a proxy out of rotation for a set period of time. Add support to programmatically revoke a proxies' candidate state (without requiring the user to write a complicated evaluator function.)
- Smarter proxy error detection: or provide support for a user-provided callback to evalute.

## Disclaimer
* THE SOFTWARE IS LICENSED UNDER THE TERMS OF THE [MIT LICENSE](https://choosealicense.com/licenses/mit/).
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. 
* IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
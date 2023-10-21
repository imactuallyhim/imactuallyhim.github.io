import type { GenericClient } from './Client';
import { statusRedirect } from './Client';
import ClientV1 from './V1';
import ClientV2 from './V2';
import { validProtocol } from './encodeProtocol';

// Implements the protocol for requesting bare data from a server
// See ../Server/Send.mjs

export * from './Client';

const clientCtors: [string, { new (server: URL): GenericClient }][] = [
	['v2', ClientV2],
	['v1', ClientV1],
];

export type BareMethod =
	| 'GET'
	| 'POST'
	| 'DELETE'
	| 'OPTIONS'
	| 'PUT'
	| 'PATCH'
	| 'UPDATE'
	| string;

export type BareCache =
	| 'default'
	| 'no-store'
	| 'reload'
	| 'no-cache'
	| 'force-cache'
	| 'only-if-cached'
	| string;

export interface XBare {
	status?: number;
	statusText?: string;
	headers?: Headers;
	rawHeaders?: BareHeaders;
}

export type BareHTTPProtocol = 'blob:' | 'http:' | 'https:' | string;
export type BareWSProtocol = 'ws:' | 'wss:' | string;

export type urlLike = URL | string;

export const maxRedirects = 20;

export type BareHeaders = { [key: string]: string | string[] };

/**
 * WebSocket with an additional property.
 */
export type BareWebSocket = WebSocket & { meta: Promise<XBare> };

/**
 * A Response with additional properties.
 */
export type BareResponse = Response & {
	rawResponse: Response;
	rawHeaders: BareHeaders;
};

/**
 * A BareResponse with additional properties.
 */
export type BareResponseFetch = BareResponse & { finalURL: string };
export type BareBodyInit =
	| Blob
	| BufferSource
	| FormData
	| URLSearchParams
	| ReadableStream
	| undefined
	| null;

export type BareFetchInit = {
	method?: BareMethod;
	headers?: Headers | BareHeaders;
	body?: BareBodyInit;
	cache?: BareCache;
	redirect?: 'follow' | 'manual' | 'error' | string;
	signal?: AbortSignal;
};

export type BareMaintainer = {
	email?: string;
	website?: string;
};

export type BareProject = {
	name?: string;
	description?: string;
	email?: string;
	website?: string;
	repository?: string;
	version?: string;
};

export type BareLanguage =
	| 'NodeJS'
	| 'ServiceWorker'
	| 'Deno'
	| 'Java'
	| 'PHP'
	| 'Rust'
	| 'C'
	| 'C++'
	| 'C#'
	| 'Ruby'
	| 'Go'
	| 'Crystal'
	| 'Shell'
	| string;

export type BareManifest = {
	maintainer?: BareMaintainer;
	project?: BareProject;
	versions: string[];
	language: BareLanguage;
	memoryUsage?: number;
};

async function fetchManifest(
	server: string | URL,
	signal?: AbortSignal
): Promise<BareManifest> {
	const outgoing = await fetch(server, { signal });

	if (!outgoing.ok) {
		throw new Error(
			`Unable to fetch Bare meta: ${outgoing.status} ${await outgoing.text()}`
		);
	}

	return await outgoing.json();
}

function resolvePort(url: URL) {
	if (url.port) return Number(url.port);

	switch (url.protocol) {
		case 'ws:':
		case 'http:':
			return 80;
		case 'wss:':
		case 'https:':
			return 443;
		default:
			// maybe blob
			return 0;
	}
}

export default class BareClient {
	/**
	 * @depricated Use .manifest instead.
	 */
	get data(): BareClient['manfiest'] {
		return this.manfiest;
	}
	manfiest?: BareManifest;
	private client?: GenericClient;
	private server: URL;
	private working?: Promise<void>;
	private onDemand: boolean;
	private onDemandSignal?: AbortSignal;
	/**
	 * Lazily create a BareClient. Calls to fetch and connect will request the manifest once on-demand.
	 * @param server A full URL to the bare server.
	 * @param signal An abort signal for fetching the manifest on demand.
	 */
	constructor(server: string | URL, signal?: AbortSignal);
	/**
	 * Immediately create a BareClient.
	 * @param server A full URL to the bare server.
	 * @param manfiest A Bare server manifest.
	 */
	constructor(server: string | URL, manfiest?: BareManifest);
	constructor(server: string | URL, _?: BareManifest | AbortSignal) {
		this.server = new URL(server);

		if (!_ || _ instanceof AbortSignal) {
			this.onDemand = true;
			this.onDemandSignal = _;
		} else {
			this.onDemand = false;
			this.manfiest = _;
			this.getClient();
		}
	}
	private demand() {
		if (!this.onDemand) return;

		if (!this.working)
			this.working = fetchManifest(this.server, this.onDemandSignal).then(
				(manfiest) => {
					this.manfiest = manfiest;
					this.getClient();
				}
			);

		return this.working;
	}
	private getClient() {
		// newest-oldest
		for (const [version, ctor] of clientCtors) {
			if (this.data!.versions.includes(version)) {
				this.client = new ctor(this.server);
				return;
			}
		}

		throw new Error(`Unable to find compatible client version.`);
	}
	async request(
		method: BareMethod,
		requestHeaders: BareHeaders,
		body: BareBodyInit,
		protocol: BareHTTPProtocol,
		host: string,
		port: string | number,
		path: string,
		cache: BareCache | undefined,
		signal: AbortSignal | undefined
	): Promise<BareResponse> {
		await this.demand();

		return await this.client!.request(
			method,
			requestHeaders,
			body,
			protocol,
			host,
			port,
			path,
			cache,
			signal
		);
	}
	async connect(
		requestHeaders: BareHeaders,
		protocol: BareWSProtocol,
		host: string,
		port: string | number,
		path: string
	): Promise<BareWebSocket> {
		await this.demand();

		return this.client!.connect(requestHeaders, protocol, host, port, path);
	}
	/**
	 *
	 * @param url
	 * @param headers
	 * @param protocols
	 * @returns
	 */
	createWebSocket(
		url: urlLike,
		headers: BareHeaders | Headers = {},
		protocols: string | string[] = []
	): Promise<BareWebSocket> {
		const requestHeaders: BareHeaders =
			headers instanceof Headers ? Object.fromEntries(headers) : headers;

		url = new URL(url);

		// user is expected to specify user-agent and origin
		// both are in spec

		requestHeaders['Host'] = url.host;
		// requestHeaders['Origin'] = origin;
		requestHeaders['Pragma'] = 'no-cache';
		requestHeaders['Cache-Control'] = 'no-cache';
		requestHeaders['Upgrade'] = 'websocket';
		// requestHeaders['User-Agent'] = navigator.userAgent;
		requestHeaders['Connection'] = 'Upgrade';

		if (typeof protocols === 'string') {
			protocols = [protocols];
		}

		for (const proto of protocols) {
			if (!validProtocol(proto)) {
				throw new DOMException(
					`Failed to construct 'WebSocket': The subprotocol '${proto}' is invalid.`
				);
			}
		}

		if (protocols.length)
			requestHeaders['Sec-Websocket-Protocol'] = protocols.join(', ');

		return this.connect(
			requestHeaders,
			url.protocol,
			url.hostname,
			resolvePort(url),
			url.pathname + url.search
		);
	}
	async fetch(
		url: urlLike | Request,
		init: BareFetchInit = {}
	): Promise<BareResponseFetch> {
		if (url instanceof Request) {
			// behave similar to the browser when fetch is called with (Request, Init)
			if (init) {
				url = new URL(url.url);
			} else {
				init = url;
				url = new URL(url.url);
			}
		} else {
			url = new URL(url);
		}

		let method: BareMethod;

		if (typeof init.method === 'string') {
			method = init.method;
		} else {
			method = 'GET';
		}

		let body: BareBodyInit;

		if (init.body !== undefined && init.body !== null) {
			body = init.body;
		}

		let headers: BareHeaders;

		if (typeof init.headers === 'object' && init.headers !== null) {
			if (init.headers instanceof Headers) {
				headers = Object.fromEntries(init.headers);
			} else {
				headers = init.headers;
			}
		} else {
			headers = {};
		}

		let cache: BareCache;

		if (typeof init.cache === 'string') {
			cache = init.cache;
		} else {
			cache = 'default';
		}

		let signal: AbortSignal | undefined;

		if (init.signal instanceof AbortSignal) {
			signal = init.signal;
		}

		for (let i = 0; ; i++) {
			if ('host' in headers) headers.host = url.host;
			else headers.Host = url.host;

			const response: BareResponse & Partial<BareResponseFetch> =
				await this.request(
					method,
					headers,
					body,
					url.protocol,
					url.hostname,
					resolvePort(url),
					url.pathname + url.search,
					cache,
					signal
				);

			response.finalURL = url.toString();

			if (statusRedirect.includes(response.status)) {
				switch (init.redirect) {
					default:
					case 'follow':
						if (maxRedirects > i && response.headers.has('location')) {
							url = new URL(response.headers.get('location')!, url);
							continue;
						} else {
							throw new TypeError('Failed to fetch');
						}
					case 'error':
						throw new TypeError('Failed to fetch');
					case 'manual':
						return <BareResponseFetch>response;
				}
			} else {
				return <BareResponseFetch>response;
			}
		}
	}
}

/**
 *
 * Facilitates fetching the Bare server and constructing a BareClient.
 * @param server Bare server
 * @param signal Abort signal when fetching the manifest
 */
export async function createBareClient(
	server: string | URL,
	signal?: AbortSignal
): Promise<BareClient> {
	const manfiest = await fetchManifest(server, signal);

	return new BareClient(server, manfiest);
}

const got = require("got");
const CookieHandler = require("../lib/cookies");
const {setHeaders, setAgent} = require("../lib/options");
const type = require("../util/types");

// Responsible for applying proxy
const requestHandler = async (request, proxy, overrides = {}) => {
    // Reject non http(s) URI schemes
    if (!request.url().startsWith("http") && !request.url().startsWith("https")) {
        request.continue(); return;
    }
    const cookieHandler = new CookieHandler(request);
    // Request options for Got accounting for overrides
    const options = {
        cookieJar: await cookieHandler.getCookies(),
        method: overrides.method || request.method(),
        body: overrides.postData || request.postData(),
        headers: overrides.headers || setHeaders(request),
        agent: setAgent(proxy),
        responseType: "buffer",
        maxRedirects: 15,
        throwHttpErrors: false,
        ignoreInvalidCookies: true,
        followRedirect: false
    };
    if(/^https:\/\/streeteasy\.com/.test(request.url())) {
        options.cookieJar.setCookieSync('_px3=70c6e163ceacf3f9ab201d6f773f8d72d13e316b6fe46e2776e40a41b9467bea:b6Eop5i1cYXVkFsVgIHstRNrPMSyeIXEIsoqPmv7K+/4aAkvl+WREaJeL9xcZ5CrP10cKrjsH96jczdbgN/YIA==:1000:UMhDMDiwa2bAd7Ic8gfm124pceeNDIPZKKj6TBmtf4ENBNyYddNbDHhrwb4UH1IIsdCqga3e4aekaQEZ8Ma2r1VnBxNkinVObdGDQFLNeTIbwD+u7wHQmrFlSP7lW4icX3BtTuwLC4jccf+KCOmrldfO7wt1BMczj5myp76LSZk=', 'https://streeteasy.com/');
    }
    try {
        const response = await got(overrides.url || request.url(), options);
        // Set cookies manually because "set-cookie" doesn't set all cookies (?)
        // Perhaps related to https://github.com/puppeteer/puppeteer/issues/5364
        const setCookieHeader = response.headers["set-cookie"];
        if (setCookieHeader) {
            await cookieHandler.setCookies(setCookieHeader);
            response.headers["set-cookie"] = undefined;
        }
        await request.respond({
            status: response.statusCode,
            headers: response.headers,
            body: response.body
        });
    } catch (error) {
        await request.abort();
    }
};

// For reassigning proxy of page
const removeRequestListener = (page, listenerName) => {
    const eventName = "request";
    const listeners = page.eventsMap.get(eventName);
    if (listeners) {
        const i = listeners.findIndex((listener) => {
            return listener.name === listenerName
        });
        listeners.splice(i, 1);
        if (!listeners.length) {
            page.eventsMap.delete(eventName);
        }
    }
};

// Calls this if request object passed
const proxyPerRequest = async (request, data) => {
    let proxy, overrides;
    // Separate proxy and overrides
    if (type(data) === "object") {
        if (Object.keys(data).length !== 0) {
            proxy = data.proxy;
            delete data.proxy;
            overrides = data;
        }
    } else {proxy = data}
    // Skip request if proxy omitted
    if (proxy) {await requestHandler(request, proxy, overrides)}
    else {request.continue(overrides)}
};

// Calls this if page object passed
const proxyPerPage = async (page, proxy) => {
    await page.setRequestInterception(true);
    const listener = "$ppp_request_listener";
    removeRequestListener(page, listener);
    const f = {[listener]: async (request) => {
        await requestHandler(request, proxy);
    }};
    if (proxy) {page.on("request", f[listener])}
    else {await page.setRequestInterception(false)}
};

// Main function
const useProxy = async (target, data) => {
    const targetType = target.constructor.name;
    if (targetType === "HTTPRequest") {
        await proxyPerRequest(target, data);
    } else if (targetType === "Page") {
        await proxyPerPage(target, data);
    }
};

module.exports = useProxy;

const axios = require("axios");
const puppeteer = require("puppeteer");
const launchChromeLambda = require("@serverless-chrome/lambda");
const debug = require("debug")("wrap-browser");

//generate a "stage1" (browser) for <name>
module.exports = userFn => {
  if (typeof userFn !== "function") {
    throw `expected userFn function`;
  }
  //return wrapped function
  return async input => {
    debug("launching lambda chrome...");
    const chrome = await launchChromeLambda({
      flags: ["--window-size=1280,1696", "--hide-scrollbars"]
    });
    if (!chrome.url && chrome.port) {
      chrome.url = `http://localhost:${chrome.port}`;
    }
    if (!chrome.url) {
      throw `need chrome url`;
    }
    const resp = await axios.get(`${chrome.url}/json/version`);
    const { webSocketDebuggerUrl } = resp.data;
    const browser = await puppeteer.connect({
      browserWSEndpoint: webSocketDebuggerUrl
    });
    debug("chrome version:", await browser.version());
    const page = await browser.newPage();
    //add "service" api
    page.service = new PageService(page);
    //load user page
    try {
      //user function
      return await userFn(page, browser, input);
    } catch (err) {
      throw err;
    } finally {
      debug(`closing page...`);
      await page.close();
      await browser.disconnect();
      if (chrome.kill) {
        await chrome.kill();
      }
    }
  };
};

class PageService {
  constructor(page) {
    this.page = page;
    this.names = { set: true };
  }

  async call(name, ...args) {
    if (!this.names[name]) {
      throw `service ${name} not defined`;
    }
    //bound evaluate
    return await this.page.evaluate(
      //args are serialsed, jfetch is run in browser
      async (name, ...args) => await window[name](...args),
      //pass into function above
      name,
      ...args
    );
  }

  async set(name, fn) {
    if (this.names[name]) {
      throw `service ${name} already defined`;
    }
    if (typeof fn !== "function") {
      throw `service ${name} must be a function`;
    }
    const fnStr = `${fn}`;
    if (!/^async /.test(fnStr)) {
      throw `service ${name} must be an async function`;
    }
    //define service on the page
    const evalStr = `window.${name} = ${fnStr};`;
    this.names[name] = true;
    return await this.page.evaluate(evalStr);
  }
}

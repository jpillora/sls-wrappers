const { Client } = require("jp-s3");
const debug = require("debug")("wrap-status");

//wrap function with s3 atomic locking
module.exports = (fn, opts = {}) => {
  if (typeof fn !== "function") {
    throw `expected function`;
  }
  //customise name?
  const { name = process.env.AWS_LAMBDA_FUNCTION_NAME } = opts;
  if (!name) {
    throw `expected 'name' string`;
  }
  //user s3 client
  let { s3, bucket = process.env.BUCKET } = opts;
  if (!s3 && bucket) {
    s3 = new Client({ bucket });
  }
  if (!s3) {
    throw `expected 's3' client or 'bucket' string`;
  }
  //expiry defaults to 1hr
  const { waitPeriod = 60 * 60 * 1000 } = opts;
  //optional error handler
  const { handleError } = opts;
  //return wrapped function
  return async input => {
    //start ticking...
    const startedAt = new Date();
    //check status
    let status = await s3.readJSON(`${name}.status`);
    if (status && status.errors && status.errors > 0) {
      const errAt = new Date(status.date);
      const delta = +startedAt - errAt;
      //within 1 hour, wait
      if (delta < waitPeriod) {
        //errored recent
        debug(`errored recently (${delta}ms ago), waiting...`);
        return false; //dont run function
      }
    }
    //prepare status (if new)
    if (!status) {
      status = {};
    }
    try {
      //run user function
      let output = await fn(input);
      status.success = true;
      status.errors = [];
      return output;
    } catch (err) {
      //accumulate errors (max 100)
      status.success = false;
      const prev = status.errors || [];
      const next = [`${err}`].concat(prev).slice(0, 100);
      status.errors = next;
      //handle errors
      if (typeof handleError === "function") {
        const promise = handleError(next);
        if (promise instanceof Promise) {
          await promise;
        }
      }
      //proxy throw
      throw err;
    } finally {
      //always write status
      status.duration = +new Date() - startedAt;
      status.date = startedAt;
      await s3.writeJSON(`${name}.status`, status);
      debug("wrote status");
    }
  };
};

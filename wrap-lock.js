const { Client } = require("jp-s3");
const debug = require("debug")("wrap-lock");

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
  //expiry defaults to 3mins
  const { expiry = 3 * 60 * 1000 } = opts;
  //return wrapped function
  return async input => {
    //aquire a lock
    const releaseLock = await s3.acquireLock(name, expiry);
    debug("acquired lock");
    try {
      //run user function
      return await fn(input);
    } catch (err) {
      //proxy throw
      throw err;
    } finally {
      //always release
      await releaseLock();
      debug("released lock");
    }
  };
};

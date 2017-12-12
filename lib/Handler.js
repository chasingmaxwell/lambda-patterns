class Handler {
  /**
   * Creates an instance of a handler and returns a function which can be used
   * as a lambda handler.
   *
   * @param {Function} processor
   *   A function responsible for processing the handler event.
   * @param {Object} options
   *   An object containing options which modify the behavior of the handler.
   */
  static create(processor, options) {
    const handler = new this(processor, options);
    return (...args) => handler.invoke(...args);
  }

  /**
   * Constructs a handler.
   *
   * @param {Function} processor
   *   A function responsible for processing the handler event.
   * @param {Object} options
   *   An object containing options which modify the behavior of the handler.
   * @param {Boolean} [options.enableProfiling=false]
   *   Specify whether profiling data should be collected for the handler
   *   invocation.
   *
   *   WARNING: Enabling profiling will impact performance. You should usually
   *   not enable this feature on production.
   * @param {Boolean} [options.waitForEventLoop=true]
   *   Specify whether the lambda process should be frozen immediately upon
   *   callback invocation.
   *
   *   WARNING: Changing this option can result in unexpected behavior and bugs
   *   that are difficult to track down. Only set this to false if you are
   *   certain there are no application critical tasks being performed
   *   asynchronously which may not be completed before you invoke the callback.
   *   For more information:
   *   http://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
   */
  constructor(processor, options = {}) {
    if (typeof processor !== 'function') {
      throw new Error('Handlers must be constructed with a function for processing');
    }

    this.processor = processor;

    // We only require the profiler if we need it to ensure as little impact as
    // possible when profiling is disabled.
    if (options.enableProfiling && typeof this.constructor.profiler === 'undefined') {
      this.constructor.profiler = require('v8-profiler-lambda'); // eslint-disable-line global-require
      this.constructor.deflateSync = require('zlib').deflateSync; // eslint-disable-line global-require
    }

    this.options = options;
  }

  /**
   * Invoke the handler.
   *
   * @param {Object} event
   *   The event object passed to the lambda handler.
   * @param {Object} context
   *   The context object passed to the lambda handler.
   * @param {Function} callback
   *   The callback passed to the lambda handler used to respond to the
   *   invocation.
   * @returns {Promise}
   */
  invoke(event, context, callback) {
    this.event = event;
    this.context = context;
    this.callback = callback;

    return Promise.resolve()
      .then(() => this.init())
      .then(() => this.process())
      .then(res => Promise.resolve()
        .then(() => this.cleanup())
        .then(() => this.respond(null, res))
        .catch(err => this.respond(err)))
      .catch(error => Promise.resolve()
        .then(() => this.cleanup())
        .then(() => this.respond(error))
        .catch(err => this.respond(err)));
  }

  /**
   * Perform initialization tasks upon handler invocation.
   */
  init() {
    if (this.options.enableProfiling) {
      this.constructor.profiler.startProfiling(this.context.awsRequestId);
    }

    // @TODO: fix logic here.
    if (this.options.waitForEventLoop) {
      // eslint-disable-next-line no-param-reassign
      this.context.callbackWaitsForEmptyEventLoop = false;
    }
  }

  /**
   * Perform the primary processing task for the handler.
   *
   * @returns {*}
   *   The value to return as the response in the handler callback or a promise
   *   which resolves with it.
   */
  process() {
    return this.processor(this.event, this.context);
  }

  /**
   * Perform cleanup tasks before responding.
   */
  cleanup() {
    if (this.options.enableProfiling) {
      const profile = this.constructor.profiler.stopProfiling(this.context.awsRequestId);
      this.profile = this.constructor.deflateSync(JSON.stringify(profile)).toString('base64');
      profile.delete();
    }
  }

  /**
   * Handle the response.
   *
   * @param {Error} error
   *   The error passed from the handler process.
   * @param {*} response
   *   The response from the handler process.
   */
  respond(error, response) {
    this.callback(error, response);
  }
}

module.exports = Handler;

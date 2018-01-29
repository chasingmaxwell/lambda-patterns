let isColdStart = true;

/**
 * Provides common functionality for lambda handlers.
 */
class Handler {
  /**
   * A utility method which always returns true.
   *
   * @returns Boolean
   *   Always returns true.
   */
  static always() {
    return true;
  }

  /**
   * A utility method which always returns false.
   *
   * @returns Boolean
   *   Always returns false.
   */
  static never() {
    return false;
  }

  /**
   * @type {Object}
   *   The default options for the constructor.
   * @static
   */
  static get defaultOptions() {
    return {
      shouldProfile: this.never,
      waitForEventLoop: true,
    };
  }

  /**
   * Creates an instance of a handler and returns a function to be used as a
   * lambda handler.
   *
   * This can be used when defining the handler like this:
   *
   * @example
   * module.exports = {
   *   yourHandler: Handler.create(event => ({
   *     statusCode: 200,
   *     body: JSON.stringify({
   *       message: 'This handler was created with lambda-patterns!',
   *       input: event,
   *     }),
   *   })),
   * };
   *
   * @param {Function} processor
   *   A function responsible for processing the primary task of the lambda. It
   *   receives the handler instance as an argument.
   * @param {Object} options
   *   An object containing options which modify the behavior of the handler.
   * @param {Function} [options.shouldProfile=Handler.never]
   *   Provide a function which specifies whether profiling data should be
   *   collected for the handler invocation. Defaults to Handler.never which
   *   always returns false.
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
   *
   * @returns {Function}
   *   A function to be used as a lambda handler which utilizes an instance of
   *   the Handler class.
   *
   * @static
   */
  static create(processor, options = {}) {
    return (...args) => new this(processor, options).invoke(...args);
  }

  /**
   * Constructs a handler.
   *
   * @param {Function} processor
   *   A function responsible for processing the handler event.
   * @param {Object} options
   *   An object containing options which modify the behavior of the handler.
   * @param {Function} [options.shouldProfile=Handler.never]
   *   See Handler.create for detailed description.
   * @param {Boolean} [options.waitForEventLoop=true]
   *   See Handler.create for detailed description.
   */
  constructor(processor, options = {}) {
    if (typeof processor !== 'function') {
      throw new Error('Handlers must be constructed with a function for processing');
    }

    this.processor = processor;

    this.options = Object.assign({}, this.constructor.defaultOptions, options);
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
    this.isColdStart = isColdStart;
    isColdStart = false;

    this.profilingEnabled = this.options.shouldProfile(this);
    this.startProfiling();

    if (this.options.waitForEventLoop === false) {
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
    return this.processor(this);
  }

  /**
   * Perform cleanup tasks before responding.
   */
  cleanup() {
    this.stopProfiling();
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

  /**
   * Start profiling.
   */
  startProfiling() {
    if (!this.profilingEnabled) {
      // #donothing
      return;
    }

    // We only require the profiler if we need it to ensure as little impact as
    // possible when profiling is disabled.
    if (!this.constructor.profiler) {
      this.constructor.profiler = require('v8-profiler-lambda'); // eslint-disable-line global-require
    }
    if (!this.constructor.deflateSync) {
      this.constructor.deflateSync = require('zlib').deflateSync; // eslint-disable-line global-require
    }

    // Start profiling.
    this.constructor.profiler.startProfiling(this.context.awsRequestId);
  }

  /**
   * Stop profiling.
   */
  stopProfiling() {
    if (!this.profilingEnabled) {
      // #donothing
      return;
    }

    const profile = this.constructor.profiler.stopProfiling(this.context.awsRequestId);
    this.profile = this.constructor.deflateSync(JSON.stringify(profile)).toString('base64');
    profile.delete();
  }
}

module.exports = Handler;

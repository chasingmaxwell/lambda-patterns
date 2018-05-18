// @flow

import type { // eslint-disable-line import/no-extraneous-dependencies
  Context,
  Callback,
} from 'flow-aws-lambda';
import typeof {
  deflateSync,
} from 'zlib';

const PercentageIncrementor = require('percentage-incrementor');

const coldStartPercentage = new PercentageIncrementor(isColdStart => !!isColdStart);
const profilePercentage = new PercentageIncrementor(isProfiling => !!isProfiling);
let isColdStart = true;

/**
 * Provides common functionality for lambda handlers.
 */
class Handler {
  processor: (handler: Handler) => any;
  options: { [string]: any };
  event: any;
  context: Context;
  callback: Callback;
  isColdStart: boolean;
  container: {
    coldStartPercentage: PercentageIncrementor,
    profilePercentage: PercentageIncrementor,
    totalInvocations: number,
  };
  profilingEnabled: ?boolean;
  profile: ?string;
  static profiler: ?{
    startProfiling: (id: string) => void,
    stopProfiling: (id: string) => {
      delete: () => void,
    },
  };
  static zlib: ?{
    deflateSync: deflateSync,
  };


  /**
   * A utility method which always returns true.
   *
   * @returns {Boolean}
   *   Always returns true.
   */
  static always() {
    return true;
  }

  /**
   * A utility method which always returns false.
   *
   * @returns {Boolean}
   *   Always returns false.
   */
  static never() {
    return false;
  }

  /**
   * @type {Object}
   * The default options for the constructor.
   * @static
   */
  static get defaultOptions(): {
    shouldProfile: (handler: Handler) => boolean,
    waitForEventLoop: boolean,
    profileStrategy: string,
    profilePercentage: number,
    } {
    return {
      shouldProfile: this.shouldProfile,
      profileStrategy: 'NEVER',
      profilePercentage: 10,
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
   * @param {Function} options.shouldProfile=Handler.never
   *   Provide a function which specifies whether profiling data should be
   *   collected for the handler invocation. Defaults to Handler.never which
   *   always returns false.
   *
   *   WARNING: Enabling profiling will impact performance. You should usually
   *   not enable this feature on production.
   * @param {Boolean} options.waitForEventLoop=true
   *   Specify whether the lambda process should be frozen immediately upon
   *   callback invocation.
   *
   *   WARNING: Changing this option can result in unexpected behavior and bugs
   *   that are difficult to track down. Only set this to false if you are
   *   certain there are no application critical tasks being performed
   *   asynchronously which may not be completed before you invoke the callback.
   *   For more information:
   *   http://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
   * @param {String} options.profileStrategy="NEVER"
   *   Specify the profiling strategy if using the default shouldProfile method.
   *   Supported strategies:
   *   - ALWAYS
   *     Always profile every invocation.
   *
   *   - ALL_COLD_STARTS
   *     Profile every cold start.
   *
   *   - ONE_COLD_ONE_WARM
   *     Profile every cold start and one warmed invocation.
   *
   *   - PERCENTAGE
   *     Profile a percentage of invocations. This requires the percentage
   *     configuration property below.
   * @param {Number} options.profilePercentage=10
   *   If using the "PERCENTAGE" profiling strategy, specify the percentage of
   *   invocations which should be profiled.
   *
   * @returns {Function}
   *   A function to be used as a lambda handler which utilizes an instance of
   *   the Handler class.
   *
   * @static
   */
  static create(
    processor: $PropertyType<Handler, 'processor'>,
    options: $PropertyType<Handler, 'options'>
  ): (
    event: $PropertyType<Handler, 'event'>,
    context: $PropertyType<Handler, 'context'>,
    callback: $PropertyType<Handler, 'callback'>
  ) => Promise<void> {
    return (...args) => new this(processor, options, ...args).invoke();
  }

  /**
   * Constructs a handler.
   *
   * NOTE: Normally handlers should be constructed using the Handler.create() method.
   *
   * @see Handler.create()
   *
   * @param {Function} processor
   *   A function responsible for processing the handler event.
   * @param {Object} options
   *   An object containing options which modify the behavior of the handler.
   *   See Handler.create for a more detailed description including options
   *   properties.
   * @param {Object} event
   *   The event object passed to the lambda handler.
   * @param {Object} context
   *   The context object passed to the lambda handler.
   * @param {Function} callback
   *   The callback passed to the lambda handler used to respond to the
   *   invocation.
   */
  constructor(
    processor: $PropertyType<Handler, 'processor'>,
    options: $PropertyType<Handler, 'options'>,
    event: $PropertyType<Handler, 'event'>,
    context: $PropertyType<Handler, 'context'>,
    callback: $PropertyType<Handler, 'callback'>
  ) {
    if (typeof processor !== 'function') {
      throw new Error('Handlers must be constructed with a function for processing');
    }

    // Set properties from arguments.
    this.processor = processor;
    this.options = Object.assign({}, this.constructor.defaultOptions, options);
    this.event = event;
    this.context = context;
    this.callback = callback;
    this.isColdStart = isColdStart;
    isColdStart = false;

    coldStartPercentage.increment(this.isColdStart);

    this.container = {
      coldStartPercentage,
      profilePercentage,
      totalInvocations: coldStartPercentage.total,
    };
  }

  /**
   * Invoke the handler.
   *
   * @returns {Promise<void>}
   *   A promise of the completed invocation.
   */
  invoke(): Promise<void> {
    return Promise.resolve()
      .then(() => this.init())
      .then(() => this.process())
      .then(res => Promise.resolve()
        .then(() => this.cleanup())
        .then(() => this.respond(null, res)))
      .catch(error => Promise.resolve()
        .then(() => this.cleanup())
        .then(() => this.respond(error))
        // This is here to handle additional errors generated while trying to
        // respond to an already unsuccessful request.
        .catch(err => this.respond(err))
        // This is an overly cautious best-effort measure to try to pass an
        // error back to the lambda API when the respond method is throwing.
        .catch(err => this.callback(err)));
  }

  /**
   * Perform initialization tasks upon handler invocation.
   */
  init(): void | Promise<void> {
    this.profilingEnabled = this.options.shouldProfile(this);
    profilePercentage.increment(this.profilingEnabled);
    this.startProfiling();

    if (this.options.waitForEventLoop === false) {
      // eslint-disable-next-line no-param-reassign
      this.context.callbackWaitsForEmptyEventLoop = false;
    }
  }

  /**
   * Perform the primary processing task for the handler.
   *
   * @returns
   *   The value to return as the response in the handler callback or a promise
   *   which resolves with it.
   */
  process(): any {
    return this.processor(this);
  }

  /**
   * Perform cleanup tasks before responding.
   */
  cleanup(): void | Promise<void> {
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
  respond(error: ?Error, response: any): void | Promise<void> {
    this.callback(error, response);
  }

  /**
   * Start profiling.
   */
  startProfiling(): void {
    if (!this.profilingEnabled) {
      // #donothing
      return;
    }

    // We only require the profiler if we need it to ensure as little impact as
    // possible when profiling is disabled.
    if (!this.constructor.profiler) {
      this.constructor.profiler = require('v8-profiler-lambda'); // eslint-disable-line global-require
    }
    if (!this.constructor.zlib) {
      this.constructor.zlib = require('zlib'); // eslint-disable-line global-require
    }

    // Start profiling.
    this.constructor.profiler.startProfiling(this.context.awsRequestId);
  }

  /**
   * Stop profiling.
   */
  stopProfiling(): void {
    if (!this.profilingEnabled ||
      !this.constructor.profiler
    ) {
      // #donothing
      return;
    }

    const profile = this.constructor.profiler.stopProfiling(this.context.awsRequestId);

    if (this.constructor.zlib) {
      this.profile = this.constructor.zlib.deflateSync(JSON.stringify(profile)).toString('base64');
    }

    profile.delete();
  }

  /**
   * The default shouldProfile implementation.
   *
   * @param {Handler} handler
   *   The handler instance for which we are determining whether profiling
   *   should be enabled.
   *
   * @returns {Boolean}
   *   Whether or not profiling should be enabled.
   */
  static shouldProfile(handler: Handler): boolean {
    let shouldProfile = false;
    switch (handler.options.profileStrategy) {
      case 'ALWAYS':
        shouldProfile = true;
        break;
      case 'ALL_COLD_STARTS':
        shouldProfile = handler.isColdStart;
        break;
      case 'ONE_COLD_ONE_WARM':
        // If we've seen two invocations thus far, we know one of them was cold
        // and one warm.
        shouldProfile = handler.container.totalInvocations < 3;
        break;
      case 'PERCENTAGE':
        shouldProfile = profilePercentage * 100 < handler.options.profilePercentage;
        break;
      default:
    }

    return shouldProfile;
  }
}

module.exports = Handler;

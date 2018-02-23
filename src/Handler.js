// @flow

import type { // eslint-disable-line import/no-extraneous-dependencies
  Context,
  Callback,
} from 'flow-aws-lambda';
import typeof {
  deflateSync,
} from 'zlib';

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
  isColdStart: ?boolean;
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
   * @returns
   *   Always returns true.
   */
  static always() {
    return true;
  }

  /**
   * A utility method which always returns false.
   *
   * @returns
   *   Always returns false.
   */
  static never() {
    return false;
  }

  /**
   * The default options for the constructor.
   */
  static get defaultOptions(): { shouldProfile: () => boolean, waitForEventLoop: boolean } {
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
   * @param processor
   *   A function responsible for processing the primary task of the lambda. It
   *   receives the handler instance as an argument.
   * @param options
   *   An object containing options which modify the behavior of the handler.
   * @param options.shouldProfile=Handler.never
   *   Provide a function which specifies whether profiling data should be
   *   collected for the handler invocation. Defaults to Handler.never which
   *   always returns false.
   *
   *   WARNING: Enabling profiling will impact performance. You should usually
   *   not enable this feature on production.
   * @param options.waitForEventLoop=true
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
   * @returns
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
   * @param processor
   *   A function responsible for processing the handler event.
   * @param options
   *   An object containing options which modify the behavior of the handler.
   * @param options.shouldProfile=Handler.never
   *   See Handler.create for detailed description.
   * @param options.waitForEventLoop=true
   *   See Handler.create for detailed description.
   * @param event
   *   The event object passed to the lambda handler.
   * @param context
   *   The context object passed to the lambda handler.
   * @param callback
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
  }

  /**
   * Invoke the handler.
   *
   * @returns
   *   A promise of the completed invocation.
   */
  invoke(): Promise<void> {
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
  init(): void | Promise<void> {
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
   * @param error
   *   The error passed from the handler process.
   * @param response
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
}

module.exports = Handler;

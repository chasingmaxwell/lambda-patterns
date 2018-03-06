jest.mock('v8-profiler-lambda');
jest.mock('zlib');

const Handler = require('../../lib/Handler');

describe('Handler', () => {
  let event;
  let context;
  let callback;
  let options;
  let processor;
  let mocks = [];

  beforeEach(() => {
    event = { iAm: 'an event' };
    context = { iAm: 'context', callbackWaitsForEmptyEventLoop: true };
    callback = jest.fn();
    options = { iAm: 'options' };
    processor = jest.fn();
    mocks.forEach(mock => mock.mockRestore());
    mocks = [];
  });

  test('always() returns true', () => {
    expect.assertions(1);
    expect(Handler.always()).toBe(true);
  });

  test('never() returns false', () => {
    expect.assertions(1);
    expect(Handler.never()).toBe(false);
  });

  test('defaultOptions are defined', () => {
    expect.assertions(1);
    expect(Handler.defaultOptions).toMatchSnapshot();
  });

  describe('constructor()', () => {
    it('throws an error it is invoked without a processor function', () => {
      expect.assertions(1);
      expect(() => new Handler(undefined, options, event, context, callback))
        .toThrow('Handlers must be constructed with a function for processing');
    });

    it('constructs a new instance', () => {
      const handler = new Handler(processor, options, event, context, callback);
      expect(handler.processor).toEqual(processor);
      expect(handler.options).toEqual(Object.assign({}, Handler.defaultOptions, options));
      expect(handler.event).toEqual(event);
      expect(handler.callback).toEqual(callback);
      expect(handler.isColdStart).toBe(true);
    });

    it('sets isColdStart to false after the first invocation', () => {
      const handler = new Handler(processor, options, event, context, callback);
      expect(handler.isColdStart).toBe(false);
    });

    it('tracks container metrics', () => {
      expect.assertions(3);
      const handler = new Handler(processor, options, event, context, callback);
      expect(handler.container.coldStartPercentage.valueOf()).toBe(1 / 3);
      expect(handler.container.profilePercentage.valueOf()).toBe(0);
      expect(handler.container.totalInvocations).toBe(3);
    });
  });

  test('create() creates a new Handler and returns a lambda handler which invokes it', () => {
    expect.assertions(5);
    processor.mockImplementationOnce((handler) => {
      expect(handler.event).toEqual(event);
      expect(handler.context).toEqual(context);
      expect(handler.options.iAm).toBe('options');
    });
    const lambdaHandler = Handler.create(processor, options);
    return lambdaHandler(event, context, callback)
      .then(() => {
        expect(processor).toHaveBeenCalled();
        expect(callback).toHaveBeenCalled();
      });
  });

  describe('invoke()', () => {
    it('runs through each step of the invocation process', () => {
      const steps = ['init', 'process', 'cleanup', 'respond'];
      expect.assertions(steps.length);
      const handler = new Handler(processor, options, event, context, callback);
      const handlerMocks = steps.map(step => jest.spyOn(
        Handler.prototype,
        step
      ).mockReturnValue(Promise.resolve()));
      mocks = mocks.concat(handlerMocks);
      return handler.invoke()
        .then(() => {
          handlerMocks.forEach((mock) => {
            expect(mock).toHaveBeenCalledTimes(1);
          });
        });
    });

    it('does not invoke cleanup() until after process() has completed', () => {
      expect.assertions(1);
      mocks.push(jest.spyOn(Handler.prototype, 'cleanup'));
      processor = () => new Promise((resolve) => {
        process.nextTick(() => {
          expect(Handler.prototype.cleanup).not.toHaveBeenCalled();
          resolve();
        });
      });
      const handler = new Handler(processor, options, event, context, callback);
      return handler.invoke();
    });

    it('still calls cleanup() if process() fails', () => {
      mocks.push(jest.spyOn(Handler.prototype, 'cleanup'));
      processor = () => {
        throw new Error('FAIL');
      };
      const handler = new Handler(processor, options, event, context, callback);
      return handler.invoke()
        .then(() => {
          expect(Handler.prototype.cleanup).toHaveBeenCalled();
        });
    });

    it('sends the result of process() to respond()', () => {
      expect.assertions(1);
      const response = { iAm: 'a response' };
      processor = () => response;
      const handler = new Handler(processor, options, event, context, callback);
      mocks.push(jest.spyOn(handler, 'respond'));
      return handler.invoke()
        .then(() => {
          expect(handler.respond).toHaveBeenCalledWith(null, response);
        });
    });

    it('catches errors at all pre-response steps', () => {
      const steps = ['init', 'process', 'cleanup'];
      expect.assertions(steps.length);
      mocks.push(jest.spyOn(Handler.prototype, 'respond'));
      return Promise.all(steps.map((toThrow) => {
        const handler = new Handler(processor, options, event, context, callback);
        const error = new Error(toThrow);
        const handlerMocks = steps.map(step => jest.spyOn(
          handler,
          step
        ).mockReturnValue(step === toThrow ? Promise.reject(error) : Promise.resolve()));
        return handler.invoke()
          .then(() => {
            expect(handler.respond).toHaveBeenCalledWith(error);
            handlerMocks.forEach(mock => mock.mockRestore());
          });
      }));
    });

    it('catches a single error in the respond method', () => {
      expect.assertions(3);
      const response = { iAm: 'a response' };
      processor = () => response;
      const handler = new Handler(processor, options, event, context, callback);
      const error = new Error('yikes!');
      mocks.push(jest.spyOn(handler, 'respond')
        .mockReturnValueOnce(Promise.reject(error)));
      return handler.invoke()
        .then(() => {
          expect(handler.respond).toHaveBeenCalledWith(null, response);
          expect(handler.respond).toHaveBeenCalledWith(error);
          expect(handler.respond).toHaveBeenCalledTimes(2);
        });
    });

    it('catches three errors in the respond method then falls back to invoking the callback directly', () => {
      expect.assertions(5);
      const response = { iAm: 'a response' };
      processor = () => response;
      const handler = new Handler(processor, options, event, context, callback);
      const errorOne = new Error('yikes!');
      const errorTwo = new Error('another yikes!');
      const errorThree = new Error('another yikes!');
      mocks.push(jest.spyOn(handler, 'respond')
        .mockReturnValueOnce(Promise.reject(errorOne))
        .mockReturnValueOnce(Promise.reject(errorTwo))
        .mockReturnValueOnce(Promise.reject(errorThree)));
      return handler.invoke()
        .then(() => {
          expect(handler.respond).toHaveBeenCalledWith(null, response);
          expect(handler.respond).toHaveBeenCalledWith(errorOne);
          expect(handler.respond).toHaveBeenCalledWith(errorTwo);
          expect(handler.respond).toHaveBeenCalledTimes(3);
          expect(callback).toHaveBeenCalledWith(errorThree);
        });
    });
  });

  describe('init()', () => {
    beforeEach(() => {
      mocks.push(jest.spyOn(Handler.prototype, 'startProfiling'));
    });

    it('determines whether profiling should be enabled', () => {
      expect.assertions(4);
      options.shouldProfile = jest.fn(() => false);
      const handler = new Handler(processor, options, event, context, callback);
      mocks.push(jest.spyOn(handler.container.profilePercentage, 'increment'));
      handler.init();
      expect(options.shouldProfile).toHaveBeenCalledWith(handler);
      expect(handler.profilingEnabled).toBe(false);
      expect(handler.startProfiling).toHaveBeenCalled();
      expect(handler.container.profilePercentage.increment).toHaveBeenCalledWith(false);
    });

    it('determines whether the Lambda API should wait for an empty even loop to end the invocation and respond', () => {
      expect.assertions(2);
      const handler = new Handler(processor, options, event, context, callback);
      handler.init();
      expect(handler.context.callbackWaitsForEmptyEventLoop).toBe(true);
      options = { waitForEventLoop: false };
      const impatientHandler = new Handler(processor, options, event, context, callback);
      impatientHandler.init();
      expect(impatientHandler.context.callbackWaitsForEmptyEventLoop).toBe(false);
    });
  });

  test('process() invokes the processor passed to the constructor', () => {
    expect.assertions(1);
    processor = jest.fn();
    const handler = new Handler(processor, options, event, context, callback);
    handler.process();
    expect(processor).toHaveBeenCalledWith(handler);
  });

  test('cleanup() stops profiling', () => {
    expect.assertions(1);
    mocks.push(jest.spyOn(Handler.prototype, 'stopProfiling'));
    const handler = new Handler(processor, options, event, context, callback);
    handler.cleanup();
    expect(handler.stopProfiling).toHaveBeenCalled();
  });

  test('respond() proxies the callback', () => {
    const responses = [
      [null, { iAm: 'a response' }],
      [new Error('something broke'), undefined],
    ];
    expect.assertions(responses.length);
    const handler = new Handler(processor, options, event, context, callback);
    responses.forEach((response) => {
      handler.respond(...response);
      expect(callback).toHaveBeenCalledWith(...response);
    });
  });

  describe('startProfiling()', () => {
    it('does nothing when profiling is not enabled', () => {
      expect.assertions(2);
      const handler = new Handler(processor, options, event, context, callback);
      handler.profilingEnabled = false;
      handler.startProfiling();
      expect(Handler.profiler).toBeUndefined();
      expect(Handler.zlib).toBeUndefined();
    });

    it('only loads profiling libs when necessary', () => {
      expect.assertions(2);
      const handler = new Handler(processor, options, event, context, callback);
      const profiler = { startProfiling: () => {} };
      const zlib = { iAm: 'already loaded' };
      Handler.profiler = profiler;
      Handler.zlib = zlib;
      handler.profilingEnabled = true;
      handler.startProfiling();
      expect(Handler.profiler).toEqual(profiler);
      expect(Handler.zlib).toEqual(zlib);
      delete Handler.profiler;
      delete Handler.zlib;
    });

    it('starts profiling when profiling is enabled', () => {
      expect.assertions(3);
      const handler = new Handler(processor, options, event, context, callback);
      handler.profilingEnabled = true;
      handler.startProfiling();
      expect(Handler.profiler).not.toBeUndefined();
      expect(Handler.zlib).not.toBeUndefined();
      expect(Handler.profiler.startProfiling).toHaveBeenCalled();
    });

    it('does not need to require profiling dependencies more than once', () => {
      expect.assertions(2);
      const handler = new Handler(processor, options, event, context, callback);
      expect(handler.constructor.profiler).not.toBeUndefined();
      expect(handler.constructor.zlib).not.toBeUndefined();
    });
  });

  describe('stopProfiling()', () => {
    const profile = {
      delete: jest.fn(),
    };
    const deflated = {
      toString: jest.fn(() => 'A profile!'),
    };

    beforeEach(() => {
      Handler.zlib.deflateSync.mockReturnValueOnce(deflated);
      Handler.profiler.stopProfiling.mockReturnValueOnce(profile);
    });

    it('does nothing when profiling is not enabled', () => {
      expect.assertions(3);
      const handler = new Handler(processor, options, event, context, callback);
      handler.profilingEnabled = false;
      handler.stopProfiling();
      expect(Handler.profiler.stopProfiling).not.toHaveBeenCalled();
      expect(Handler.zlib.deflateSync).not.toHaveBeenCalled();
      expect(handler.profile).toBeUndefined();
    });

    // This is kind of silly, but the condition we're testing was necessary to
    // account for the nullable type on the zlib property.
    it('does not collect a profile if we somehow do not have our zlib dependency', () => {
      expect.assertions(2);
      const handler = new Handler(processor, options, event, context, callback);
      handler.profilingEnabled = true;
      const originalZlib = Handler.zlib;
      delete Handler.zlib;
      handler.stopProfiling();
      expect(originalZlib.deflateSync).not.toHaveBeenCalled();
      expect(handler.profile).toBeUndefined();
      Handler.zlib = originalZlib;
    });

    it('stops profiling when profiling is enabled', () => {
      expect.assertions(3);
      const awsRequestId = 'request123';
      context = { awsRequestId };
      const handler = new Handler(processor, options, event, context, callback);
      handler.profilingEnabled = true;
      handler.stopProfiling();
      expect(Handler.profiler.stopProfiling).toHaveBeenCalledWith(awsRequestId);
      expect(Handler.zlib.deflateSync).toHaveBeenCalledWith(JSON.stringify(profile));
      expect(profile.delete).toHaveBeenCalled();
    });
  });

  describe('shouldProfile()', () => {
    it('returns false by default', () => {
      expect.assertions(1);
      const handler = new Handler(processor, options, event, context, callback);
      expect(Handler.shouldProfile(handler)).toBe(false);
    });
    it('always returns true with the ALWAYS profiling strategy', () => {
      expect.assertions(1);
      options = { profileStrategy: 'ALWAYS' };
      const handler = new Handler(processor, options, event, context, callback);
      expect(Handler.shouldProfile(handler)).toBe(true);
    });

    it('only profiles cold starts with the ALL_COLD_STARTS profiling strategy', () => {
      expect.assertions(2);
      options = { profileStrategy: 'ALL_COLD_STARTS' };
      const handler = new Handler(processor, options, event, context, callback);
      handler.isColdStart = false;
      expect(Handler.shouldProfile(handler)).toBe(false);
      handler.isColdStart = true;
      expect(Handler.shouldProfile(handler)).toBe(true);
    });

    it('only profiles two invocations with the ONE_COLD_ONE_WARM profiling strategy', () => {
      expect.assertions(3);
      options = { profileStrategy: 'ONE_COLD_ONE_WARM' };

      // Reset the coldStartPercentage.
      const someHandler = new Handler(processor, options, event, context, callback);
      someHandler.container.coldStartPercentage.total = 0;
      someHandler.container.coldStartPercentage.subset = 0;

      function mockInvoke(withProfiling = false) {
        const handler = new Handler(processor, options, event, context, callback);
        expect(Handler.shouldProfile(handler)).toBe(withProfiling);
      }

      mockInvoke(true);
      mockInvoke(true);
      mockInvoke(false);
    });

    it('profiles a percentage of invocations with the PERCENTAGE profiling strategy', () => {
      expect.assertions(8);
      options = { profileStrategy: 'PERCENTAGE', profilePercentage: 20 };
      const handler = new Handler(processor, options, event, context, callback);
      handler.container.profilePercentage.total = 0;
      handler.container.profilePercentage.subset = 0;

      function mockInvoke(withProfiling = false) {
        expect(Handler.shouldProfile(handler)).toBe(withProfiling);
        handler.container.profilePercentage.increment(withProfiling);
      }

      // 0%
      mockInvoke(true);
      // 100%
      mockInvoke(false);
      // 50%
      mockInvoke(false);
      // 33.3333%
      mockInvoke(false);
      // 25%
      mockInvoke(false);
      // 20%
      mockInvoke(false);
      // 16.6666%
      mockInvoke(true);
      // 25%
      mockInvoke(false);
    });
  });
});

# <!--emdaer-p
  - '@emdaer/plugin-value-from-package'
  - value: name
--> · <!--emdaer-p
  - '@emdaer/plugin-shields'
  - shields:
      - alt: 'Travis'
        image: 'travis/chasingmaxwell/lambda-patterns.svg?branch=master'
        link: 'https://travis-ci.org/chasingmaxwell/lambda-patterns'
      - alt: 'Documented with emdaer'
        image: 'badge/📓-documented%20with%20emdaer-F06632.svg'
        link: 'https://github.com/emdaer/emdaer'
        style: 'flat-square'
      -->

<!--emdaer-p
  - '@emdaer/plugin-value-from-package'
  - value: description
-->

<!-- toc -->

## Installation

`yarn add lambda-patterns`

 OR

`npm i --save lambda-patterns`

## Usage

### Handler

The `Handler` class facilitates common patterns in lambda handlers through some useful abstractions. For example, it processes events through a standard flow (`init` -> `process` -> `cleanup` -> `respond`) which allows you to alter and extend behavior in a repeatable way across multiple handlers. It also includes optional [profiling functionality](#enable-profiling) out-of-the-box!

#### Simple Usage

To start with, let's just look at the simplest example:

```javascript
// ./handler.js

const { Handler } = require('lambda-patterns');

module.exports = {
  yourHandler: Handler.create(({ event }) => ({
    statusCode: 200,
    body: JSON.stringify({
      message: 'This handler was created with lambda-patterns!',
      input: event,
    }),
  })),
};
```

#### Cold start detection

Cold starts are detected with each invocation by taking advantage of the shared require cache between lambda invocations in the same container. The detection takes place in the `init()` step. The result is stored in the `isColdStart` boolean property on the handler. This allows you to alter behavior for cold starts only. For example, you might want to enable profiling only for cold starts or log a message to better understand the impact of cold starts to your application.

```javascript
// ./handler.js

const { Handler } = require('lambda-patterns');

module.exports = {
  yourHandler: Handler.create(handler => {
    if (handler.isColdStart) {
      console.log('Cold start!');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'This handler was created with lambda-patterns!',
        input: handler.event,
      }),
    }
  }),
};
```


#### Enable profiling

The `Handler` class also ships with an option to enable profiling with [v8-lambda-profiler](https://github.com/iopipe/v8-profiler-lambda). The profile data will be stored in a "profile" property on the handler in the cleanup method. You can then extend `Handler` to store the profile data with your preferred method (write to s3 or log to CloudWatch, for example).

```javascript
// ./handler.js

const { Handler } = require('lambda-patterns');

class MyHandler extends Handler {
  cleanup() {
    super.cleanup();
    if (this.profile) {
      // log profile data to CloudWatch.
      console.log('Profile:', this.profile);
    }
  }
}

module.exports = {
  yourHandler: MyHandler.create(
    ({ event }) => ({
      statusCode: 200,
      body: JSON.stringify({
        message: 'This handler was created with lambda-patterns!',
        input: event,
      }),
    }),
    // shouldProfile is a function which receives the handler instance as its
    // only argument and returns either true or false to indicate whether
    // profiling data should be collected for the invocation. By default,
    // profiling is always disabled. In this example we are using the handler's
    // cold start detection to enable profiling only for cold starts.
    { shouldProfile: handler => handler.isColdStart }
  ),
};
```

## Documentation

See the [DOCUMENTATION.md](./DOCUMENTATION.md) file.

## Contributors

<!--emdaer-p
  - '@emdaer/plugin-contributors-details-github'
-->

## License

<!--emdaer-p
  - '@emdaer/plugin-license-reference'
-->

<!--emdaer-t
  - '@emdaer/transform-table-of-contents'
-->

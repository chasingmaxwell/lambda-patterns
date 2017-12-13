# <!--emdaer-p
  - '@emdaer/plugin-value-from-package'
  - value: name
--> · <!--emdaer-p
  - '@emdaer/plugin-shields'
  - shields:
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
  yourHandler: Handler.create(event => ({
    statusCode: 200,
    body: JSON.stringify({
      message: 'This handler was created with lambda-patterns!',
      input: event,
    }),
  })),
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
    event => ({
      statusCode: 200,
      body: JSON.stringify({
        message: 'This handler was created with lambda-patterns!',
        input: event,
      }),
    }),
    { enableProfiling: true }
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

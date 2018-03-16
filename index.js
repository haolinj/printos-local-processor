const express = require('express');
const request = require('request');
const awsIot = require('aws-iot-device-sdk');
const cmdLineProcess = require('./lib/cmdline');
const isUndefined = require('./lib/is-undefined');
const bodyParser = require('body-parser');
const fp = require('lodash/fp');
const urlencode = require('urlencode');

// @see https://stackoverflow.com/a/17606289
String.prototype.replaceAll = function (search, replacement) {
  var target = this;
  return target.split(search).join(replacement);
};

const app = express();
app.use(bodyParser.urlencoded());

var printJobs = {
  ids: [],
  data: []
};

var activeJobs = {};

const thingName = 'printos';

function start(args) {

  const device = awsIot.device({
    keyPath: args.privateKey,
    certPath: args.clientCert,
    caPath: args.caCert,
    clientId: args.clientId,
    region: args.region,
    baseReconnectTimeMs: args.baseReconnectTimeMs,
    keepalive: args.keepAlive,
    protocol: args.Protocol,
    port: args.Port,
    host: args.Host,
    debug: args.Debug
  });

  const jobs = awsIot.jobs({
    keyPath: args.privateKey,
    certPath: args.clientCert,
    caPath: args.caCert,
    clientId: args.clientId,
    host: args.Host
  });

  jobs.subscribeToJobs(thingName, function (err, job) {
    if (isUndefined(err)) {
      console.log('customJob operation handler invoked, jobId: ' + job.id.toString());
      console.log('job document: ', job.document);

      const { id, data } = job.document;

      printJobs.ids.push(id);
      printJobs.data.push(data);

      activeJobs[id] = job;

      job.inProgress();
    }
    else {
      console.error(err);
      job.failed();
    }
  });

  jobs.startJobNotifications(thingName, function (err) {
    if (isUndefined(err)) {
      console.log('job notifications initiated for thing: ' + thingName);
    }
    else {
      console.error(err);
    }
  });

  const minimumDelay = 5000;

  // Health check.
  const timeout = setInterval(function () {
    device.publish('topic/print/brod_kingston/hc', JSON.stringify({
      status: 'OK',
      timestamp: new Date().valueOf()
    }));

  }, Math.max(args.delay, minimumDelay));
}


cmdLineProcess('connect to the AWS IoT service and publish/subscribe to topics using MQTT, test modes 1-2',
  process.argv.slice(2), start);

app.post('/submit', (req, res) => {

  const data = req.body;
  const printData = urlencode.decode(data.data.replaceAll(/\+/g, '%20'));

  console.log(printData);

  printJobs.ids.push('-1');
  printJobs.data.push(printData);

  res.send({
    pass: true
  });
});

app.post('/lookup', (req, res) => {
  res.send({
    pass: true,
    version: 5,
    ids: printJobs.ids,
    data: printJobs.data
  });
});

app.post('/update', (req, res) => {

  console.log(req.body);
  if (req.body.id !== '-1') {
    request.post({ url: 'https://j2csa1uxqj.execute-api.ap-southeast-2.amazonaws.com/dev/update', form: req.body }, function (err, httpResponse, body) {
      const job = activeJobs[req.body.id];
      const index = fp.indexOf(req.body.id)(printJobs.ids);

      printJobs.ids = fp.remove(id => id === req.body.id)(printJobs.ids);
      printJobs.data.splice(index, 1);

      console.log(printJobs.ids, printJobs.data);

      if (req.body.status === 'Completed') {
        console.log('Marking job success', req.body.id);
        job && job.succeeded();

        res.send({
          pass: true
        });
      }
      else {
        job && job.failed();
        res.send({
          pass: false
        });
      }
    });
  }
  else {
    const index = fp.indexOf(req.body.id)(printJobs.ids);
    printJobs.ids = fp.remove(id => id === req.body.id)(printJobs.ids);
    printJobs.data.splice(index, 1);
    console.log('Marking local job success', req.body.id);
    res.send({
      pass: true
    });
  }
});


app.listen(8083, () => console.log('PrintOS processor running and listening on port 8083!'));

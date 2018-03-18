const express = require('express');
const request = require('request');
const awsIot = require('aws-iot-device-sdk');
const bodyParser = require('body-parser');
const fp = require('lodash/fp');
const urlencode = require('urlencode');
const argsParser = require('args-parser');
const appConf = require('./config/app.conf');

const app = express();
const args = argsParser(process.argv);

app.use(bodyParser.urlencoded({ extended: true }));

var activeJobs = {};
var printJobs = {
  ids: [],
  data: []
};

const start = (args) => {
  const jobs = awsIot.jobs({
    keyPath: args['private-key'],
    certPath: args['client-certificate'],
    caPath: args['ca-certificate'],
    host: args['host-name']
  });

  jobs.subscribeToJobs(appConf.thingName, function (err, job) {
    if (fp.isEmpty(err)) {
      const { id, data } = job.document;

      console.log('Prcessing print job\n', job.document);

      printJobs.ids.push(id);
      printJobs.data.push(data);
      activeJobs[id] = job;

      job.inProgress();
    }
    else {
      console.error('Failed to process print job.', printValue(err));

      job.failed();
    }
  });

  jobs.startJobNotifications(appConf.thingName, function (err) {
    if (fp.isEmpty(err)) {
      console.log('Job notifications initiated for Thing', printValue(appConf.thingName));
    }
    else {
      console.error(err);
    }
  });
};

app.post('/submit', (req, res) => {
  const data = req.body;
  const printData = urlencode.decode(data.data.replaceAll(/\+/g, '%20'));

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
  // Local print jobs will have -1 as job id.
  if (req.body.id !== '-1') {
    request.post({ url: appConf.printServerUrl + '/update', form: req.body }, function (err, httpResponse, body) {
      const job = activeJobs[req.body.id];
      const index = fp.indexOf(req.body.id)(printJobs.ids);
      printJobs.ids = fp.remove(id => id === req.body.id)(printJobs.ids);
      printJobs.data.splice(index, 1);

      if (req.body.status === 'Completed') {
        console.log('Print job completed', printValue(req.body.id));

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

    console.log('local print job completed', printValue(req.body.id));

    res.send({
      pass: true
    });
  }
});

// @see https://stackoverflow.com/a/17606289
String.prototype.replaceAll = function (search, replacement) {
  var target = this;
  return target.split(search).join(replacement);
};

const printValue = (value) => '[' + value + ']';

start(args);

app.listen(8083, () => console.log('PrintOS processor running and listening on port 8083!'));

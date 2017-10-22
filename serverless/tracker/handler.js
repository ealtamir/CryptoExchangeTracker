'use strict';
const env = require('process').env;
const _ = require('lodash');
const as = require('async');
const fs = require('fs');
const AWS = require('aws-sdk');
const request = require('request');

const MAX_RETRIES = 3;

if (env.ENVIRONMENT === 'DEBUG') {
  AWS.config.update({
    region: env.AWS_REGION || 'localhost',
    endpoint: 'http://localhost:8000'
  });
}

const dynamodb = new AWS.DynamoDB.DocumentClient();
const data = JSON.parse(fs.readFileSync(env['data']));


module.exports.bitfinex_tracker = (event, context, callback) => {
  _.each(data, (exchangeData) => {
    const trackerLinks = _.map(exchangeData['available_symbols'], (symbolObj) => {
      return function(cb) {
        const url = exchangeData.ticker_url + '/' + symbolObj.symbol;
        console.log(url)
        request(url, (err, resp, body) => {
          if (err || (resp && resp.statusCode !== 200)) {
            return cb(err, null)
          }
          const respJSON = _.extend(JSON.parse(body), symbolObj);
          return cb(null, respJSON);
        });
      }
    });
    as.parallel(trackerLinks, (err, results) => {
      if (err) {
        console.log(`Failed to fetch data from exchange: ${JSON.stringify(err)}`);
        return callback(null, {statusCode: 400})
      }
      const timestamp = +new Date();
      const exchange = exchangeData.exchange_name;
      const params = {
        TableName: env.tableName,
        Item: {
          id: `${exchange}_${timestamp}`,
          exchange: exchange,
          timestamp: timestamp,
          data: results
        }
      }
      console.log(params)
      dynamodb.put(params, (err, data) => {
        if (err) {
          console.log(`Failed to store data in dynamodb: ${JSON.stringify(err)}`);
          return callback(null, {statusCode: 400})
        }
        const response = {
          statusCode: 200,
          body: JSON.stringify({
            message: 'Everything went as expected!',
            data: data
          }),
        };
        callback(null, response);
        return console.log(JSON.stringify(data));
      })
    });
  })
}

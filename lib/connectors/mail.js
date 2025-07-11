// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

/**
 * Dependencies.
 */

'use strict';
const g = require('../globalize');
const mailer = require('nodemailer');
const assert = require('node:assert');
const debug = require('debug')('loopback:connector:mail');
const loopback = require('../loopback');

/**
 * Export the MailConnector class.
 */

module.exports = MailConnector;

/**
 * Create an instance of the connector with the given `settings`.
 */

function MailConnector(settings) {
  assert(typeof settings === 'object', 'cannot initialize MailConnector without a settings object');

  let transports = settings.transports;

  // if transports is not in settings object AND settings.transport exists
  if (!transports && settings.transport) {
    // then wrap single transport in an array and assign to transports
    transports = [settings.transport];
  }

  if (!transports) {
    transports = [];
  }

  this.transportsIndex = {};
  this.transports = [];

  if (loopback.isServer) {
    transports.forEach(this.setupTransport.bind(this));
  }
}

MailConnector.initialize = function(dataSource, callback) {
  dataSource.connector = new MailConnector(dataSource.settings);
  callback();
};

MailConnector.prototype.DataAccessObject = Mailer;

/**
 * Add a transport to the available transports. See https://github.com/andris9/Nodemailer#setting-up-a-transport-method.
 *
 * Example:
 *
 *   Email.setupTransport({
 *       type: "SMTP",
 *       host: "smtp.gmail.com", // hostname
 *       secureConnection: true, // use SSL
 *       port: 465, // port for secure SMTP
 *       alias: "gmail", // optional alias for use with 'transport' option when sending
 *       auth: {
 *           user: "gmail.user@gmail.com",
 *           pass: "userpass"
 *       }
 *   });
 *
 */

MailConnector.prototype.setupTransport = function(setting) {
  const connector = this;
  connector.transports = connector.transports || [];
  connector.transportsIndex = connector.transportsIndex || {};

  let transport;
  const transportType = (setting.type || 'STUB').toLowerCase();
  if (transportType === 'smtp') {
    transport = mailer.createTransport(setting);
  } else {
    const transportModuleName = 'nodemailer-' + transportType + '-transport';
    const transportModule = require(transportModuleName);
    transport = mailer.createTransport(transportModule(setting));
  }

  connector.transportsIndex[setting.alias || setting.type] = transport;
  connector.transports.push(transport);
};

function Mailer() {

}

/**
 * Get a transport by name.
 *
 * @param {String} name
 * @return {Transport} transport
 */

MailConnector.prototype.transportForName = function(name) {
  return this.transportsIndex[name];
};

/**
 * Get the default transport.
 *
 * @return {Transport} transport
 */

MailConnector.prototype.defaultTransport = function() {
  return this.transports[0] || this.stubTransport;
};

/**
 * Send an email with the given `options`.
 *
 * Example Options:
 *
 * {
 *   from: "Fred Foo ✔ <foo@blurdybloop.com>", // sender address
 *   to: "bar@blurdybloop.com, baz@blurdybloop.com", // list of receivers
 *   subject: "Hello ✔", // Subject line
 *   text: "Hello world ✔", // plaintext body
 *   html: "<b>Hello world ✔</b>", // html body
 *   transport: "gmail", // See 'alias' option above in setupTransport
 * }
 *
 * See https://github.com/andris9/Nodemailer for other supported options.
 *
 * @param {Object} options
 * @param {Function} callback Called after the e-mail is sent or the sending failed
 */

Mailer.send = async function(options) {
  const dataSource = this.dataSource;
  const settings = dataSource && dataSource.settings;
  const connector = dataSource.connector;
  assert(connector, 'Cannot send mail without a connector!');

  let transport = connector.transportForName(options.transport);

  if (!transport) {
    transport = connector.defaultTransport();
  }

  if (debug.enabled || settings && settings.debug) {
    g.log('Sending Mail:');
    if (options.transport) {
      console.log(g.f('\t TRANSPORT:%s', options.transport));
    }
    g.log('\t TO:%s', options.to);
    g.log('\t FROM:%s', options.from);
    g.log('\t SUBJECT:%s', options.subject);
    g.log('\t TEXT:%s', options.text);
    g.log('\t HTML:%s', options.html);
  }

  if (transport) {
    assert(transport.sendMail,
      'You must supply an Email.settings.transports containing a valid transport');
    return transport.sendMail(options)
  } 
  else {
    g.warn('Warning: No email transport specified for sending email.' +
      ' Setup a transport to send mail messages.')
    return options;
  }
};

/**
 * Send an email instance using `modelInstance.send()`.
 */

Mailer.prototype.send = async function() {
  return this.constructor.send(this)
}

/**
 * Access the node mailer object.
 */

MailConnector.mailer =
MailConnector.prototype.mailer =
Mailer.mailer =
Mailer.prototype.mailer = mailer;

'use strict'

var net = require('net')
var tls = require('tls')
var Connection = require('mqtt-connection')
var MqttServer
var MqttServerNoWait
var MqttSecureServer

var setupConnection = function (duplex) {
  var that = this
  var connection = new Connection(duplex, function () {
    that.emit('client', connection)
  })
}

/*
 * MqttServer
 *
 * @param {Function} listener - fired on client connection
 */
class MqttServer extends net.Server {
  constructor(listener) {
    super()

    var that = this
    this.on('connection', setupConnection)

    if (listener) {
      this.on('client', listener)
    }    
  }
}

/*
 * MqttServerNoWait (w/o waiting for initialization)
 *
 * @param {Function} listener - fired on client connection
 */
class MqttServerNoWait extends net.Server {
  constructor (listener) {
    super()
    this.on('connection', function (duplex) {
      var connection = new Connection(duplex)
      // do not wait for connection to return to send it to the client.
      this.emit('client', connection)
    })

    if (listener) {
      this.on('client', listener)
    }
  }
}

/**
 * MqttSecureServer
 *
 * @param {Object} opts - server options
 * @param {Function} listener
 */
class MqttSecureServer extends tls.Server {
  constructor(opts, listener) {
    super(opts)
    if (typeof opts === 'function') {
      listener = opts
      opts = {}
    }

    setupConnection = setupConnection

    if (listener) {
      this.on('client', listener)
    }

    this.on('secureConnection', setupConnection)
  }
}

exports.MqttServer = MqttServer
exports.MqttServerNoWait = MqttServerNoWait
exports.MqttSecureServer = MqttSecureServer
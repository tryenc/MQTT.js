'use strict'

var net = require('net')
var tls = require('tls')
var Connection = require('mqtt-connection')

/*
 * MqttServer
 *
 * @param {Function} listener - fired on client connection
 */
class MqttServer extends net.Server {
  constructor (listener) {
    super()

    var that = this
    this.on('connection', function (duplex) {
      var connection = new Connection(duplex, function () {
        that.emit('client', connection)
      })
    })

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
  constructor (opts, listener) {
    if (typeof opts === 'function') {
      listener = opts
      opts = {}
    }

    // sets a listener for the 'connection' event
    super(opts)

    this.on('secureConnection', function (socket) {
      this.socket = socket
      var that = this
      var connection = new Connection(socket, function () {
        that.emit('client', connection)
      })
    })

    if (listener) {
      this.on('client', listener)
    }
  }

  static setupConnection (duplex) {
    var that = this
    var connection = new Connection(duplex, function () {
      that.emit('client', connection)
    })
  }
}

exports.MqttServer = MqttServer
exports.MqttServerNoWait = MqttServerNoWait
exports.MqttSecureServer = MqttSecureServer
